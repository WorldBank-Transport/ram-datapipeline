# RAM Vector Tiles

Dockerfile for the ram-vt

Contains:
- `osmtogeojson` to convert `.xml` to `.geojson`
- `tippecanoe` to create the vector tiles
- `ram-vt` to create vector tiles from a file on s3 and upload them to s3.

### Standalone commands

osmtogeojson
```
docker run -it --rm -v $(pwd):/data wbtransport/ram-vt node --max_old_space_size=8192 /usr/local/bin/osmtogeojson /data/[input.xml] > [output.geojson]
```

tippecanoe
```
docker run -it --rm -v $(pwd):/data wbtransport/ram-vt tippecanoe -l road-network -e /data/[output.mbtiles] [input.geojson]
```

### ram-vt

Requires the following env variables:
- PROJECT_ID - Id of the RAM project.
- SCENARIO_ID - Id of the RAM scenario.
- VT_TYPE - Type of tile to create. Either `road-network` or `admin-bounds`.
- SOURCE_FILE - File path on the storage bucket.
- STORAGE_HOST - Storage host.
- STORAGE_PORT - Storage port
- STORAGE_ENGINE - Storage engine. Either `minio` or `s3`
- STORAGE_ACCESS_KEY - Storage access key.
- STORAGE_SECRET_KEY - Storage secret key.
- STORAGE_BUCKET - Storage bucket.
- STORAGE_REGION - Storage region.