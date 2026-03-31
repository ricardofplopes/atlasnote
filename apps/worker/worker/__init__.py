"""Atlas Note Worker — Background service for chunking and embedding notes."""
import asyncio
import logging
import sys
import os

# Add the api app to the path so we can reuse models/config
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "apps", "api"))

from worker.chunker import run_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    logger.info("Atlas Note Worker starting...")
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
