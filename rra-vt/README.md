# RRA-VT

Dockerfile for the rra-vt

Contains:
- `osmtogeojson` to convert `.xml` to `.geojson`
- `tippecanoe` to create the vector tiles

### Commands

osmtogeojson
```
docker run -it --rm -v $(pwd):/data wbtransport/rra-vt node --max_old_space_size=8192 /usr/local/bin/osmtogeojson /data/[input.xml] > [output.geojson]
```

tippecanoe
```
docker run -it --rm -v $(pwd):/data wbtransport/rra-vt tippecanoe -l road-network -e /data/[output.mbtiles] [input.geojson]
```
