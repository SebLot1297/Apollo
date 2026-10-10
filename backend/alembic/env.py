from alembic import context
from app.models.storage import Base

connection = context.config.attributes.get("connection")
if connection is None:
    from app.core.config import Settings
    from app.db.database import Database

    database = Database(Settings())
    with database.engine.begin() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    database.close()
else:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
