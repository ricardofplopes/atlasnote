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
    """Run the chunker, backup scheduler, and reminder extraction concurrently."""
    from worker.backup import run_auto_backup, BACKUP_INTERVAL_HOURS
    from worker.reminders import run_reminder_extraction, REMINDER_INTERVAL_HOURS

    async def backup_loop():
        while True:
            try:
                await run_auto_backup()
            except Exception as e:
                logger.error(f"Auto-backup error: {e}")
            await asyncio.sleep(BACKUP_INTERVAL_HOURS * 3600)

    async def reminder_loop():
        await asyncio.sleep(300)  # Wait 5 min on startup before first run
        while True:
            try:
                await run_reminder_extraction()
            except Exception as e:
                logger.error(f"Reminder extraction error: {e}")
            await asyncio.sleep(REMINDER_INTERVAL_HOURS * 3600)

    await asyncio.gather(run_worker(), backup_loop(), reminder_loop())


if __name__ == "__main__":
    main()
