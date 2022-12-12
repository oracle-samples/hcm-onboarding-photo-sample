/*
* Copyright (c) 2022, Oracle and/or its affiliates.
* Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
*/

/*
*This module handles all OCI object storage related calls.
*Resource principal authentication must be used by the function using this module.
*Otherwise, the calls with fail. This module cannot be tested locally using node.
*/
const os = require("oci-objectstorage");
const common = require("oci-common");

const readObject = async function (input){

  const provider = common.ResourcePrincipalAuthenticationDetailsProvider.builder();

  const bucket = input.bucket;
  const object = input.object;
  const namespace = input.namespace;
  var getObjectResponse = null;

  const client = new os.ObjectStorageClient({
    authenticationDetailsProvider: provider
  });

  try {

    const getObjectRequest = {
      objectName: object,
      bucketName: bucket,
      namespaceName: namespace
    };
    getObjectResponse = await client.getObject(getObjectRequest);

    var objData='';

    for await (const chunk of getObjectResponse.value) {
      objData+= chunk;
    }
    return objData;
  } catch (err) {
    console.log("Error fetching object" + err);
    return  "Error:" + err.message;
  }
};

const writeObject = async function (input, objData){

  const provider = common.ResourcePrincipalAuthenticationDetailsProvider.builder();

  var putObjectResponse = null;

  const client = new os.ObjectStorageClient({
    authenticationDetailsProvider: provider
  });

  try {

     const Readable = require('stream').Readable;
	 var s = new Readable();
	 s.push(objData);
	 s.push(null);

     const putObjectRequest = {
      namespaceName: input.namespace,
      bucketName: input.bucket,
      putObjectBody: s,
      objectName: input.object,
      contentLength: objData.length
    };

    const putObjectResponse = await client.putObject(putObjectRequest);

    return "Completed";
  } catch (err) {
    console.log("Error storing object " + err.message);
    return  "Error:" + err.message;
  }
};

module.exports = {
  readObject: readObject,
  writeObject: writeObject
}
