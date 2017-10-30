# Start from ubuntu
FROM node:6

# Update repos and install dependencies
RUN apt-get update \
  && apt-get -y upgrade \
  && apt-get -y install git build-essential libsqlite3-dev zlib1g-dev

# Create a directory and copy in all files
RUN mkdir -p /tmp/tippecanoe-src
WORKDIR /tmp/tippecanoe-src
RUN git clone --branch 1.24.1 https://github.com/mapbox/tippecanoe.git /tmp/tippecanoe-src

# Build tippecanoe
RUN make \
  && make install

# Remove the temp directory and unneeded packages
WORKDIR /
RUN rm -rf /tmp/tippecanoe-src \
  && apt-get -y remove --purge build-essential && apt-get -y autoremove

# Install osmtogeojson
RUN npm install -g osmtogeojson

# Vt generation
COPY . /code

WORKDIR /code

RUN yarn

RUN mkdir /conversion

### Create link for easy access
RUN echo '#!/bin/bash' > /usr/local/bin/rra-vt; echo 'node /code/index.js' >> /usr/local/bin/rra-vt; chmod +x /usr/local/bin/rra-vt