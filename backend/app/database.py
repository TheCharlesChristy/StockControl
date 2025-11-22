"""
Database configuration and session management.
"""
from sqlalchemy import create_engine, Column, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.sql import func
from typing import Generator
from .config import settings

# Create SQLAlchemy engine with connection pooling
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,  # Verify connections before using
    pool_size=10,  # Maximum number of permanent connections
    max_overflow=20,  # Maximum number of overflow connections
    echo=settings.DEBUG,  # Log SQL statements in debug mode
) if settings.DATABASE_URL else None

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None

# Create declarative base for models
Base = declarative_base()


class BaseModel(Base):
    """
    Base model class with common fields for all database models.
    
    Includes:
    - id: Primary key
    - created_at: Timestamp when record was created
    - updated_at: Timestamp when record was last updated
    """
    __abstract__ = True
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function to get database session.
    
    Yields:
        Session: SQLAlchemy database session
        
    Usage:
        @app.get("/items")
        def read_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    """
    if SessionLocal is None:
        raise RuntimeError("Database is not configured. Please set DATABASE_URL environment variable.")
    
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize database by creating all tables.
    This should only be used for development/testing.
    In production, use Alembic migrations.
    """
    if engine is None:
        raise RuntimeError("Database is not configured. Please set DATABASE_URL environment variable.")
    
    Base.metadata.create_all(bind=engine)
