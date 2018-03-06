# rra-osm

Container for running ogr2osm in an OS agnostic environment.

## Setup

1. Install Docker
2. `docker build -t rra-osm .`
3. `docker run -it --rm -v $(pwd):/data rra-osm python ogr2osm /data/[input.shp/geojson] > [output.osm]`