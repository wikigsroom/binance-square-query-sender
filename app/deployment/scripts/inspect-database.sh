set -eu
runuser -u postgres -- psql -p 5433 -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT version();
SELECT current_setting('unix_socket_directories');
SELECT datname FROM pg_database WHERE datname = 'square_platform';
SELECT rolname FROM pg_roles WHERE rolname = 'square_platform';
SELECT count(*) AS active_connections FROM pg_stat_activity;
SQL
ss -lnt '( sport = :39410 )'
