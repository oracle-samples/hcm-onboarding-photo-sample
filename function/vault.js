/*
* Copyright (c) 2022, Oracle and/or its affiliates.
* Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
*/

//This module handles getting a secret from OCI vault.
//OCIDs for secret and the compart are required in the input to function.
const common = require("oci-common");
const fs = require('fs');
const httpSignature = require('http-signature');

const fetchOCISecret = async function (input){
                try
                {
                        let objPromise =  getSecret(input);
                        ociSecret = await objPromise;
                        return ociSecret;
                }
                catch(err)
                {
                        console.log("Error: Trying to get secret from OCI vault. Message =>" + err.message);
                        enhancedPhoto = false;
                        return "Error: Unable to get OCI secret. Message=>" + err.message;
                }
}

function getSecret(input){

const provider = common.ResourcePrincipalAuthenticationDetailsProvider.builder();

let pem = process.env.OCI_RESOURCE_PRINCIPAL_PRIVATE_PEM;
let rpst = process.env.OCI_RESOURCE_PRINCIPAL_RPST;

rpst = fs.readFileSync(rpst, 'ascii');
    
let secretOcid = input.secretOcid;
let compartmentOcid = input.compartmentOcid;


   const secret_bundle_options = {
        hostname: input.hostname,
        port: 443,
        path: '/20190301/secretbundles/'+secretOcid,
        method: 'GET',
        headers: {
            "compartmentId": compartmentOcid,
            "stage": "CURRENT"
        }
    }
return new Promise(function (resolve, reject) {
        const https = require('https');
        let req = https.request(secret_bundle_options, (res) => {
            
            let responseBody = "";

            res.on('data', (chunk) => {
                responseBody += chunk;
            });

            res.on('end', () => {
                // here you need to extract and bas64 decode password
                let pwdResponse = JSON.parse(responseBody);
                let pwdBase64 = pwdResponse.secretBundleContent.content;
                let buff = new Buffer(pwdBase64, 'base64');
                let pwd = buff.toString('ascii');
               
                resolve(pwd);
            });
        }).on('error', (error) => {
            console.log(error)
            reject(error);
        })
     
        let kid = "ST$"+rpst;
        let signAuth = new SignatureAuthenticator(kid, pem);

        signAuth.sign(req);
        req.end();
    });

};


function SignatureAuthenticator(keyId, privateKeyPath) {
    this.keyId = keyId;    
    this.privateKey = fs.readFileSync(privateKeyPath, 'ascii');
}

SignatureAuthenticator.prototype.sign = function (request, body) {

    let headersToSign = [
        "host",
        "date",
        "(request-target)"
    ];

    let methodsThatRequireExtraHeaders = ["POST", "PUT"];

    if (methodsThatRequireExtraHeaders.indexOf(request.method.toUpperCase()) !== -1) {
        var body_string = JSON.stringify(body) || "";

        var shaObj = new jsSHA("SHA-256", "TEXT");
        shaObj.update(body_string);

        request.setHeader("Content-Length", body_string.length);
        request.setHeader("x-content-sha256", shaObj.getHash('B64'));

        headersToSign = headersToSign.concat([
            "content-type",
            "content-length",
            "x-content-sha256"
        ]);
    }

    // the main engine... that's where the signature authentication happens using http-signature module
    httpSignature.sign(request, {
        key: this.privateKey,
        keyId: this.keyId,
        headers: headersToSign
    });

    let newAuthHeaderValue = request.getHeader("Authorization").replace("Signature ", "Signature version=\"1\",");
    request.setHeader("Authorization", newAuthHeaderValue);
    return request;
}


module.exports = {
fetchOCISecret: fetchOCISecret
}
