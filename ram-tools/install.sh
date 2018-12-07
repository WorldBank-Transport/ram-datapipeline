#!/bin/sh

apt-get update
apt-get install -y curl

apt-get install -y build-essential git cmake pkg-config \
libbz2-dev libstxxl-dev libstxxl1v5 libxml2-dev \
libzip-dev libboost-all-dev lua5.2 liblua5.2-dev libtbb-dev libluabind-dev

curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.1/install.sh | bash
\. "/root/.nvm/nvm.sh" && nvm install 8

# Make node available for everyone
# https://www.digitalocean.com/community/tutorials/how-to-install-node-js-with-nvm-node-version-manager-on-a-vps
n=$(which node);n=${n%/bin/node}; chmod -R 755 $n/bin/*; cp -r $n/{bin,lib,share} /usr/local