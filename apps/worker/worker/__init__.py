"""Atlas Note Worker — Background service for chunking and embedding notes."""
import asyncio
import logging

from worker.chunker import run_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    logger.info("Atlas Note Worker starting...")
    asyncio.run(_run_all())


async def _run_all():
    """Run the chunker and the periodic backup scheduler concurrently."""
    from worker.backup import run_auto_backup, BACKUP_INTERVAL_HOURS

    async def backup_loop():
        while True:
            try:
                await run_auto_backup()
            except Exception as e:
                logger.error(f"Auto-backup error: {e}")
            await asyncio.sleep(BACKUP_INTERVAL_HOURS * 3600)

    await asyncio.gather(run_worker(), backup_loop())


if __name__ == "__main__":
    main()
