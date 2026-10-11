// Ensure tests always exercise the in-memory PGlite driver, never a real
// database URL that might be present in the developer's environment.
delete process.env.DATABASE_URL;
delete process.env.PGLITE_DATA_DIR;
