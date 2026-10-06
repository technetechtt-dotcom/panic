#!/bin/sh
set -e
cd /app/services/api
npx prisma migrate deploy
exec node dist/main.js
