module.exports = {
  run: [{
    method: "fs.rm",
    params: {
      path: "app/node_modules"
    }
  }, {
    method: "fs.rm",
    params: {
      path: "app/models"
    }
  }]
}
