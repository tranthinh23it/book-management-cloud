const mongoose = require("mongoose");

let readConnection;
let writeConnection;

async function connectDatabases() {
  readConnection = mongoose.createConnection(
    process.env.READ_MONGODB_URI
  );

  writeConnection = mongoose.createConnection(
    process.env.WRITE_MONGODB_URI
  );

  await Promise.all([
    readConnection.asPromise(),
    writeConnection.asPromise()
  ]);

  console.log("Read database connected");
  console.log("Write database connected");
}

function getConnections() {
  return { readConnection, writeConnection };
}

module.exports = { connectDatabases, getConnections };