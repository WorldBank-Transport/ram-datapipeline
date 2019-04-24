FROM ram-tools

COPY . /code

WORKDIR /code

RUN yarn

RUN mkdir /conversion && cd /conversion && echo "disk=/var/tmp/stxxl,2500,memory" > .stxxl && ln -s /code/node_modules/osrm/profiles/lib/ .

CMD ["node", "--max_old_space_size=8192 index.js"]
