#!/bin/bash

PROJECT_ID=$1
SCENARIO_ID=$2

PROJECT_ID="${PROJECT_ID:-2000}"
SCENARIO_ID="${SCENARIO_ID:-2000}"

read -p "Project $PROJECT_ID, Scenario $SCENARIO_ID. Continue? (y/n) " -n 1 -r
echo    # (optional) move to a new line
if [[ $REPLY =~ ^[Yy]$ ]]
then
  # Create work folder
  mkdir conversion
  echo "disk=/var/tmp/stxxl,2500,memory" > ./conversion/.stxxl
  ln -s ../node_modules/osrm/profiles/lib/ ./conversion/lib

  export 'DB_URI=postgresql://ram:ram@localhost:5432/ram'
  export "PROJECT_ID=$PROJECT_ID"
  export "SCENARIO_ID=$SCENARIO_ID"
  export 'STORAGE_HOST=localhost'
  export 'STORAGE_PORT=9000'
  export 'STORAGE_ENGINE=minio'
  export 'STORAGE_ACCESS_KEY=minio'
  export 'STORAGE_SECRET_KEY=miniostorageengine'
  export 'STORAGE_BUCKET=ram'
  export 'STORAGE_REGION=us-east-1'
  export 'CONVERSION_DIR=./conversion'

  node --max_old_space_size=8192 index.js
fi
