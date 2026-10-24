ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app
RUN python3 --version && pdftotext -v && tesseract --version
RUN cp apps/api/package.json /tmp/suite-api-base-package.json
COPY apps/api apps/api
COPY infrastructure/crm-skills infrastructure/crm-skills
COPY backend-dist apps/api/dist
RUN node -e 'const old=require("/tmp/suite-api-base-package.json"), current=require("./apps/api/package.json"); for(const group of ["dependencies","devDependencies"]) for(const [key,value] of Object.entries(current[group])) { if(group==="dependencies" && key==="express") { if(require("./node_modules/.pnpm/express@5.2.1/node_modules/express/package.json").version!==value) throw Error("Express version mismatch"); } else if(old[group][key]!==value) throw Error("Dependency mismatch: "+key); }' && ln -sfn ../../../node_modules/.pnpm/express@5.2.1/node_modules/express apps/api/node_modules/express
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]
