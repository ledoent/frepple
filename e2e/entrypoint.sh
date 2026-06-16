#!/usr/bin/env bash
# Entrypoint for the E2E web image. First arg selects the role:
#   wsgi  - one-time DB init (createdatabase + migrate + demo data), then the
#           Django dev server (REST API, /api/token/, output endpoints).
#   asgi  - daphne serving freppledb.asgi (websockets + engine services).
set -euo pipefail

export POSTGRES_HOST="${POSTGRES_HOST:-db}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"

echo ">> waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}"
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U frepple >/dev/null 2>&1; do
  sleep 1
done

FREPPLECTL="python /app/frepplectl.py"

case "${1:-wsgi}" in
  wsgi)
    echo ">> createdatabase + migrate"
    ${FREPPLECTL} createdatabase --skip-if-exists || true
    ${FREPPLECTL} migrate --noinput
    echo ">> loading demo data"
    ${FREPPLECTL} loaddata demo --verbosity=0 || true
    # Marker so the asgi role can wait for init to finish.
    ${FREPPLECTL} dbshell <<<"CREATE TABLE IF NOT EXISTS e2e_ready(ok int);" || true
    echo ">> starting Django (WSGI) on :8000"
    exec ${FREPPLECTL} runserver 0.0.0.0:8000
    ;;
  asgi)
    echo ">> waiting for DB init (e2e_ready)"
    until ${FREPPLECTL} dbshell <<<"SELECT 1 FROM e2e_ready;" >/dev/null 2>&1; do
      sleep 1
    done
    echo ">> starting daphne (ASGI) on :8001"
    # daphne does not call django.setup(); frepple's asgi.py imports models at
    # module load, so set Django up before daphne imports the application.
    exec python -c "import django; django.setup(); from daphne.cli import CommandLineInterface as C; C().run(['-b','0.0.0.0','-p','8001','freppledb.asgi:application'])"
    ;;
  *)
    exec "$@"
    ;;
esac
