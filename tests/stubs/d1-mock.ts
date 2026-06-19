export interface ColumnDef {
  type: string;
  notNull: boolean;
  default: string | null;
  pk: boolean;
}

export interface IndexDef {
  name: string;
  on: string;
  columns: string[];
  unique: boolean;
  partial: string | null;
}

export interface SchemaState {
  tables: Map<string, Map<string, ColumnDef>>;
  indexes: Map<string, IndexDef>;
}

export class D1Mock {
  private schema: SchemaState = { tables: new Map(), indexes: new Map() };

  exec(sql: string): void {
    for (const stmt of this.splitStatements(sql)) {
      this.execOne(stmt);
    }
  }

  getSchema(): SchemaState {
    return this.schema;
  }

  hasTable(name: string): boolean {
    return this.schema.tables.has(name);
  }

  hasColumn(table: string, col: string): boolean {
    return this.schema.tables.get(table)?.has(col) ?? false;
  }

  hasIndex(name: string): boolean {
    return this.schema.indexes.has(name);
  }

  private splitStatements(sql: string): string[] {
    const cleaned = sql.replace(/--.*$/gm, '').replace(/\n\s*\n/g, '\n');
    const stmts: string[] = [];
    let current = '';
    for (const ch of cleaned) {
      current += ch;
      if (ch === ';') { stmts.push(current.trim()); current = ''; }
    }
    const last = current.trim();
    if (last) stmts.push(last);
    return stmts.filter((s) => s.length > 0);
  }

  private execOne(sql: string): void {
    const upper = sql.toUpperCase().replace(/\s+/g, ' ').trim();

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS') || upper.startsWith('CREATE TABLE')) {
      const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*)\)\s*;?\s*$/i);
      if (!tableMatch) return;
      const tableName = tableMatch[1].toLowerCase();
      const colDefs = tableMatch[2];
      const columns = new Map<string, ColumnDef>();
      const cols = this.parseColumns(colDefs);
      for (const col of cols) columns.set(col.name, col);
      this.schema.tables.set(tableName, columns);
      return;
    }

    if (upper.startsWith('ALTER TABLE') && upper.includes('ADD COLUMN')) {
      const match = sql.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+(\w+(?:\s*\(\s*\d+\s*\))?)/i);
      if (match) {
        const table = match[1].toLowerCase();
        const col = match[2].toLowerCase();
        const type = match[3].toUpperCase();
        if (this.schema.tables.has(table)) {
          this.schema.tables.get(table)!.set(col, { type, notNull: false, default: null, pk: false });
        }
      }
      return;
    }

    if (upper.startsWith('ALTER TABLE') && upper.includes('DROP COLUMN')) {
      const match = sql.match(/ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(\w+)/i);
      if (match) {
        const table = match[1].toLowerCase();
        const col = match[2].toLowerCase();
        this.schema.tables.get(table)?.delete(col);
      }
      return;
    }

    if (upper.startsWith('DROP TABLE IF EXISTS')) {
      const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
      if (match) {
        this.schema.tables.delete(match[1].toLowerCase());
      }
      return;
    }

    if (upper.startsWith('CREATE UNIQUE INDEX IF NOT EXISTS') || upper.startsWith('CREATE UNIQUE INDEX')) {
      const match = sql.match(/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(?:\s*WHERE\s+(.+))?/i);
      if (match) {
        const name = match[1].toLowerCase();
        this.schema.indexes.set(name, {
          name, on: match[2].toLowerCase(), columns: match[3].split(',').map((c) => c.trim().toLowerCase()),
          unique: true, partial: match[4]?.trim() ?? null,
        });
      }
      return;
    }

    if (upper.startsWith('CREATE INDEX IF NOT EXISTS') || upper.startsWith('CREATE INDEX')) {
      const match = sql.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(?:\s*WHERE\s+(.+))?/i);
      if (match) {
        const name = match[1].toLowerCase();
        this.schema.indexes.set(name, {
          name, on: match[2].toLowerCase(), columns: match[3].split(',').map((c) => c.trim().toLowerCase()),
          unique: false, partial: match[4]?.trim() ?? null,
        });
      }
      return;
    }

    if (upper.startsWith('DROP INDEX IF EXISTS') || upper.startsWith('DROP INDEX')) {
      const match = sql.match(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
      if (match) {
        this.schema.indexes.delete(match[1].toLowerCase());
      }
      return;
    }

    if (upper.startsWith('ALTER TABLE') && upper.includes('RENAME TO')) {
      const match = sql.match(/ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/i);
      if (match) {
        const from = match[1].toLowerCase();
        const to = match[2].toLowerCase();
        const table = this.schema.tables.get(from);
        if (table) {
          this.schema.tables.delete(from);
          this.schema.tables.set(to, table);
        }
        // Update index references
        for (const [name, idx] of this.schema.indexes) {
          if (idx.on === from) this.schema.indexes.set(name, { ...idx, on: to });
        }
      }
      return;
    }
  }

  private parseColumns(colDefs: string): { name: string; col: ColumnDef }[] {
    const cols: { name: string; col: ColumnDef }[] = [];
    let depth = 0;
    let current = '';
    for (const ch of colDefs) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && ch === ',') {
        const parsed = this.parseOneCol(current.trim());
        if (parsed) cols.push(parsed);
        current = '';
      } else {
        current += ch;
      }
    }
    const parsed = this.parseOneCol(current.trim());
    if (parsed) cols.push(parsed);
    return cols;
  }

  private parseOneCol(def: string): { name: string; col: ColumnDef } | null {
    const upper = def.toUpperCase();
    if (upper.startsWith('PRIMARY KEY') || upper.startsWith('UNIQUE') || upper.startsWith('CHECK') || upper.startsWith('FOREIGN KEY') || upper.startsWith('CONSTRAINT')) return null;
    const parts = def.split(/\s+/);
    if (parts.length < 2) return null;
    const name = parts[0].toLowerCase().replace(/[`"]/g, '');
    const type = parts[1].toUpperCase();
    return {
      name,
      col: {
        type,
        notNull: /\bNOT\s+NULL\b/i.test(def),
        default: def.match(/\bDEFAULT\s+(\S+)/i)?.[1] ?? null,
        pk: /\bPRIMARY\s+KEY\b/i.test(def),
      },
    };
  }
}
