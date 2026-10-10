from app.core.config import Settings
from app.db.database import Database


def main():
    db = Database(Settings())
    try:
        db.migrate()
        print(db.readiness())
    finally:
        db.close()


if __name__ == "__main__":
    main()
