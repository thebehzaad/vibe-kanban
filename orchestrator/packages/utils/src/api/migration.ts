/**
 * Migration API types
 * Translates: crates/utils/src/api/migration.rs
 *
 * API types for migration operations.
 */

export interface MigrationRequest {
  sourceFormat: 'json' | 'sqlite' | 'postgres';
  data: unknown;
}

export interface MigrationResponse {
  success: boolean;
  itemsImported: number;
  errors: string[];
}

export interface ExportRequest {
  format: 'json' | 'sqlite';
  includeImages?: boolean;
}

export interface ExportResponse {
  data: unknown;
  format: string;
  timestamp: string;
}
