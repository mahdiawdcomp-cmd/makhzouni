-- Add BOX to Unit enum (PostgreSQL requires ALTER TYPE)
ALTER TYPE "Unit" ADD VALUE IF NOT EXISTS 'BOX' AFTER 'DOZEN';
