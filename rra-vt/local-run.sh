#!/bin/bash

PROJECT_ID=$1
SCENARIO_ID=$2
VT_TYPE=$3
SOURCE_FILE=$4

if [[ -z $PROJECT_ID || -z $SCENARIO_ID || -z $SOURCE_FILE  || -z $VT_TYPE ]];
then
    echo " - Missing mandatory arguments: PROJECT_ID, SCENARIO_ID, VT_TYPE, SOURCE_FILE. "
    echo " - Usage: ./local-run.sh  [PROJECT_ID] [SCENARIO_ID] [VT_TYPE] [SOURCE_FILE]. "
    exit 1
fi

# Create work folder
mkdir conversion

export 'DB_URI=postgresql://rra:rra@localhost:5432/rra'
export "PROJECT_ID=$PROJECT_ID"
export "SCENARIO_ID=$SCENARIO_ID"
export "SOURCE_FILE=$SOURCE_FILE"
export "VT_TYPE=$VT_TYPE"
export 'STORAGE_HOST=localhost'
export 'STORAGE_PORT=9000'
export 'STORAGE_ENGINE=minio'
export 'STORAGE_ACCESS_KEY=minio'
export 'STORAGE_SECRET_KEY=miniostorageengine'
export 'STORAGE_BUCKET=rra'
export 'STORAGE_REGION=us-east-1'
export 'CONVERSION_DIR=./conversion'

node index.js