// Common types used across the application

export type UUID = string;

export interface BaseEntity {
  id: UUID;
  created_at: string;
  updated_at: string;
}

export type Status = 'active' | 'inactive' | 'archived';
