from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.core.config import BACKEND


class Database:
    def __init__(self, settings):
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        kwargs = {"pool_pre_ping": True}
        if settings.sqlalchemy_url.startswith("sqlite:"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 20}
        self.engine = create_engine(settings.sqlalchemy_url, **kwargs)
        if self.engine.dialect.name == "sqlite":

            @event.listens_for(self.engine, "connect")
            def sqlite_pragmas(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA journal_mode=WAL")

        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.worker_connection = None

    def migrate(self):
        config = Config(str(BACKEND / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND / "alembic"))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    def readiness(self):
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            if self.engine.dialect.name == "postgresql":
                version = connection.execute(
                    text("SELECT extversion FROM pg_extension WHERE extname='timescaledb'")
                ).scalar()
                if not version:
                    raise RuntimeError("TimescaleDB extension missing")
                return {"engine": "postgresql/timescaledb", "status": "connected", "timescale_version": version}
        return {"engine": "sqlite/local-demo", "status": "connected"}

    def acquire_worker(self):
        if self.engine.dialect.name == "postgresql":
            self.worker_connection = self.engine.connect()
            locked = self.worker_connection.execute(text("SELECT pg_try_advisory_lock(724019827123)")).scalar()
            self.worker_connection.commit()
            if not locked:
                self.worker_connection.close()
                self.worker_connection = None
                raise RuntimeError("Another CommandGrid worker already owns this database")

    def close(self):
        if self.worker_connection is not None:
            self.worker_connection.execute(text("SELECT pg_advisory_unlock(724019827123)"))
            self.worker_connection.commit()
            self.worker_connection.close()
            self.worker_connection = None
        self.engine.dispose()
