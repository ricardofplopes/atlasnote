from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt, JWTError
import httpx

from app.core.config import get_settings
from app.core.database import get_db
from app.models import User
from app.schemas import GoogleLoginRequest, TokenResponse, UserResponse

router = APIRouter()
security = HTTPBearer()
settings = get_settings()

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(
            credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def _upsert_user(
    db: AsyncSession, provider_id: str, email: str, name: str, avatar_url: str | None
) -> User:
    """Find or create a user by provider ID."""
    result = await db.execute(select(User).where(User.google_id == provider_id))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            name=name,
            avatar_url=avatar_url,
            google_id=provider_id,
        )
        db.add(user)
        await db.flush()
    else:
        user.last_login = datetime.now(timezone.utc)
        user.name = name
        user.avatar_url = avatar_url

    return user


@router.post("/google", response_model=TokenResponse)
async def google_login(request: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a Google OAuth access token for a JWT."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {request.token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        userinfo = resp.json()

    google_id = userinfo.get("sub")
    email = userinfo.get("email")
    name = userinfo.get("name", email)
    avatar_url = userinfo.get("picture")

    if not google_id or not email:
        raise HTTPException(status_code=401, detail="Could not get user info from Google")

    user = await _upsert_user(db, f"google:{google_id}", email, name, avatar_url)
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.post("/github", response_model=TokenResponse)
async def github_login(request: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a GitHub OAuth code for a JWT."""
    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GITHUB_TOKEN_URL,
            json={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": request.token,
            },
            headers={"Accept": "application/json"},
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="GitHub token exchange failed")
        token_data = token_resp.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail=f"GitHub auth error: {token_data.get('error_description', 'unknown')}")

    # Get user info
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            GITHUB_USER_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Failed to get GitHub user info")
        gh_user = user_resp.json()

    github_id = str(gh_user.get("id"))
    email = gh_user.get("email") or f"{gh_user['login']}@github.noreply.com"
    name = gh_user.get("name") or gh_user.get("login")
    avatar_url = gh_user.get("avatar_url")

    user = await _upsert_user(db, f"github:{github_id}", email, name, avatar_url)
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    """Get the current authenticated user."""
    return user
