<h1 align="center">RAM Data Pipeline</h1>

The RAM Data Pipeline is part of the Rural Accessibility Map project, a tool that allows one to assess the accessibility of rural populations in relation to critical services. For more information and an overview of related repositories, please see [RAM Backend](https://github.com/WorldBank-Transport/ram-backend) .

## Building the images

```
cd ram-tools
docker build -t ram-tools .
```

```
cd ram-analysis
docker build -t ram-analysis .
```

## Releasing a new version
The process to release a new version:

- still on `develop`, bump the version in `./ram-vt/package.json` and/or `./ram-analysis/package.json`
- set up PR, have somebody do a review and merge `develop` into `master`
- CircleCI will add a new tag to git using the version in `package.json`  
Because this repo holds two containers that are independently versioned, the git tags are prepended with the container name (eg. `ram-vt-v0.1.0`)
- if the tagging was successful, CircleCI will build the Docker image, tag it with the version number and push it to Docker Hub. If the tagging failed (because the version wasn't updated in `package.json`), the build fails

Once this is done, you can [add a new release on Github](https://github.com/WorldBank-Transport/ram-datapipeline/releases/new) with useful notes that describe it.