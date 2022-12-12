/*
* Copyright (c) 2022, Oracle and/or its affiliates.
* Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
*/

//This function orchestrates high-level steps for processing HCM ATOM feed, for processing profile photos of new hires
//These steps can be re-used for any kind of HCM ATOM feed processing, such as directory integration.
//api.js handles HCM REST API calls and implements logic
//objectStorage.js handles OCI objectstorage fetch and store.
//vault.js handles fetching secret from OCI vault.
const fdk=require('@fnproject/fdk');
const oss=require('./objectStorage');
const api=require('./api');
const ov=require('./vault');

fdk.handle(async function(input){

  //Validate input.  Object storage namespace, bucket and object name are required.
  if(!(input.bucket &&  input.namespace && input.object && input.hostname && input.compartmentOcid && input.secretOcid && input.hcmhostname))
	return {"Error":"Object storage namespace, objecti, hostname, hcmhostname, compartmentOcid, secretOcid and bucket are required parameters."};

  try
  {
  //Get configuration from Object storage
  //Object storage is protected through resource princpal and associated OCI policies pre-defined in tenancy.
  //This part of code will fail if run in local fn environment.
  const cfg = await oss.readObject(input);

  //Get hcm credentials from OCI vault. This information is stored encrypted in vault as a secret.
  //An OCID value for the OCI secret and compartment's OCID value are required in order to fetch the secret.
  const hcmcredential = await ov.fetchOCISecret(input);

  //Launch HCM API actions. Atom feed will be polled first, using configuration in object storage.
  //Then, for each newhire that's in the the feed, execute steps to enhance and upload photos
  //Finally, update object storage with the last observed date time stamp of the feed.
  const result = await api.hcmapi(JSON.parse(cfg),input,hcmcredential);

  return "Completed";
  }
  catch(err)
  {
	console.log("Error:" + err.message);
	return "Error:" + err.message;
  }

})

