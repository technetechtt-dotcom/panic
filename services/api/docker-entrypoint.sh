#!/bin/sh
set -e
cd /app/services/api
node /app/node_modules/prisma/build/index.js migrate deploy
exec node dist/main.js
