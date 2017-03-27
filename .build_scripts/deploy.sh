#!/bin/bash
set -e

# Setting correct variables based on the environment we're deploying to
if [[ $TRAVIS_BRANCH == ${DEVELOP_BRANCH} ]]; then
  LATEST_TAG=latest-dev
elif [[ $TRAVIS_BRANCH == ${STABLE_BRANCH} ]]; then
  LATEST_TAG=latest-stable
else
  echo "Not a deployable branch"
  exit 1
fi

echo "Building source image: rra-tools"
docker build -t rra-tools ./rra-tools

# rra-analysis depends on rra-tools
echo "Building source image: rra-analysis"
docker build -t rra-analysis ./rra-analysis

docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWD"

# Only rra-analysis makes its way to Docker Hub
echo "Pushing image to Docker Hub:$TRAVIS_COMMIT"
docker tag rra-analysis $DOCKER_ORG/rra-analysis:$TRAVIS_COMMIT
docker push $DOCKER_ORG/rra-analysis:$TRAVIS_COMMIT

echo "Also pushing as :$LATEST_TAG"
docker tag rra-analysis $DOCKER_ORG/rra-analysis:$LATEST_TAG
docker push $DOCKER_ORG/rra-analysis:$LATEST_TAG
