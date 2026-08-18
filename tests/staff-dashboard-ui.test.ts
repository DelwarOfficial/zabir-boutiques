import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function walkTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkTsx(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('staff dashboard shell polish', () => {
  it('dashboard shell files no longer contain visible mojibake strings', () => {
    const files = [
      'src/pages/staff/index.astro',
      'src/layouts/StaffLayout.astro',
      'src/components/staff/layout/Navbar.astro',
      'src/components/staff/dashboard/MetricCard.tsx',
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/Â·|à§³|â†’|â€¦|â€”/);
    }
  });

  it('uses one active staff shell and removes stale StaffShell layout', () => {
    expect(existsSync(resolve('src/layouts/StaffShell.astro'))).toBe(false);
    expect(read('src/layouts/StaffLayout.astro')).toContain('Navbar');
  });

  it('uses non-blocking toast UX in StaffLayout instead of alert-driven form handling', () => {
    const src = read('src/layouts/StaffLayout.astro');
    expect(src).toContain("import '@/scripts/staff-shell';");
    expect(src).not.toContain('alert(');
    expect(read('src/scripts/staff-shell.ts')).toContain('window.showToast');
    expect(read('src/scripts/staff-shell.ts')).toContain('staff:form-success');
    expect(read('src/scripts/staff-shell.ts')).toContain("form.dataset.reloadOnSuccess === 'true'");
  });

  it('replaces fake navbar search input with real staff search navigation', () => {
    const src = read('src/components/staff/layout/Navbar.astro');
    expect(src).toContain('/staff/support/search');
    expect(src).toContain('Support search');
    expect(src).not.toContain('type="search"');
  });

  it('staff TSX components avoid React-invalid SVG kebab-case props', () => {
    const files = [
      ...walkTsx(resolve('src/components/staff')),
      ...walkTsx(resolve('src/islands/staff')),
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/stroke-width|stroke-linecap|stroke-linejoin/);
    }
  });

  it('staff shell components avoid inline scripts and inline style attributes that fight CSP', () => {
    const shellFiles = [
      'src/layouts/StaffLayout.astro',
      'src/components/staff/layout/Navbar.astro',
      'src/components/staff/layout/Sidebar.astro',
      'src/components/primitives/Toast.astro',
    ];

    for (const file of shellFiles) {
      const src = read(file);
      expect(src, file).not.toContain('is:inline');
      expect(src, file).not.toMatch(/style=/);
    }
  });
});
