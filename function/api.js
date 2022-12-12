/** Copyright (c) 2022, Oracle and/or its affiliates.
* Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
*/

/**
* This module implements integration logic.
* It starts by fetching HCM Atom feed. If there are newhires to be processed, it performs the rest of the steps.
*/
const oss=require('./objectStorage');

const hcmapi = async function (cfg,input,hcmcredential){

        //Param "input" is the same that was supplied to main program
        //Object storage namespace, bucket name and objectname for configuration.
        //Param cfg:==>
        //****HCM credentials from OCI vault.
        //****HCM Hostname
        //****Last Fetched ATOM entry
        //Validate
        console.log("Calling HCM API..");
        if(!input.hcmhostname || !cfg.lastfeedtime || !hcmcredential)
        return {"Error":"Ivalid HCM configuration."};

        console.log(" API input verified ");

        //Fetch new hires
        try{
                //Query HCM atom feed, since the last observed feed's date&time
                let atom_promise = hcmAtomFeedPromise(cfg,input.hcmhostname,hcmcredential);
                let atomresp = await atom_promise;
                console.log(" ATOM feed retrieved " + atomresp.length);
                //Process feed, if there are any.
                var orcresp = await processFeed(atomresp,cfg, input,hcmcredential);

                //Before exiting, store the first observed "updated" date time stamp and store it in cfg in object storage.
                //Atom feed has the latest entry on the top
                var strSplit = atomresp.split("<updated>");
                var strLastUpdated = strSplit[1].substr(0,24);

                cfg.lastfeedtime = strLastUpdated;
                //set object name to write.
                input.object = "config.json";
                //Store the configuration back to objects storage, using input and cfg objects.
                const respWriteObject = await oss.writeObject(input,JSON.stringify(cfg));
                console.log("Wrote updated configuration to oci object store");

                return "Completed";
        }
        catch(err)
        {
                console.log(" Error is: " + err.message);
                return "Error:" + err.message;
        }
}

//Process new hires. Start by counting the number new hires.
//For each newhire, get an image from object storage,
//improve the image (simple text overlay at this point)
//and update newhire's profile
async function processFeed(resp, cfg, input,hcmcredential){

        //Split the XML feed into entries
        var temparray= resp.split(': [');

        var newhires = [];

        //Extract the JSON snippet for each new hire.
        for(i=1;i<temparray.length;i++)
        {
                newhires[i-1] = JSON.parse(temparray[i].slice(0,temparray[i].search(' ]')));
        }

        //If there are no new hires to process, exit
        console.log('\n Number of newhires is:  ' + newhires.length);
        if ( newhires.length == 0 ){
                console.log('\n No new hires to process. Exiting.');
                return "No new hires to process.";
        }

        //Iterate through new hires and call profile photo update function for each
        //If there are failures for specific new hires, print in console. This part can be enahnced,
        //for example to post the failed newhire to a failed queue or send email notifications
        for(i=0;i<newhires.length;i++)
        {
                try{
                        await updateProfilePhoto(newhires[i], cfg, input,hcmcredential);
                }
                catch(err)
                {
                        //We are not quitting because one newhire failed. Print message and move to next. No return here.
                        console.log("Error processing newhire:" + newhires[i].PersonNumber + ". Message=>" + err.message);
                }
        }

        return "Completed";

}

//Invoke HCM ATOM feed endpoint and invoke callback function
//function hcmAtomFeed(input, fnCallBack)
function hcmAtomFeedPromise(cfg,hcmhostname,hcmcredential)
{
        return new Promise((resolve, reject) => {
                const https = require('https')
                const options = {
                        hostname: hcmhostname ,
                        port: 443,
                        path: '/hcmRestApi/atomservlet/employee/newhire?updated-min=' + cfg.lastfeedtime ,
                        method: 'GET',
                        headers: {
                                'Authorization': hcmcredential
                        }
                }

                const req = https.request(options, (response) => {
                        let chunks_of_data = [];

                        response.on('data', (fragments) => {
                                chunks_of_data.push(fragments);
                        });

                        response.on('end', () => {
                                let response_body = Buffer.concat(chunks_of_data);
                                resolve(response_body.toString());
                        });

                        response.on('error', (error) => {
                                reject(error);
                        });
                });

                req.on('error', error => {
                        console.log('\nFailure')
                        console.error(error)
                        return error;
                })

                req.end()
        });
}

async function updateProfilePhoto(newhire, cfg, input,hcmcredential)
{

        //Try to Get photo for worker using person number as object name
        //If there is no photo found, fetch the default blank profile photo
        //Get the photo from object storage => OCI Object storage API
        //Use the same namespace, bucket as configuration file.
        var photoAvailable = false;
        var enhancedPhoto = false;
        input.object = newhire.PersonNumber;


        try{
                //Get Image from OCI object storage
                var photo = await oss.readObject(input);
                //If no photo, get the default
                if(photo.length == 0 || photo.includes("Error", 0))
                {
                        console.log("Photo not available. Fetching default photo.");
                        input.object="defaultPhoto";
                        photo=await oss.readObject(input);
                }
                if(photo.length > 0 && !photo.includes("Error", 0))
                photoAvailable=true;
        }
        catch(err)
        {
                console.log("Error: Unable to obtain photo from object storage. Message=>" + err.message);
                return "Error: Unable to obtain photo from object storage. Message=>" + err.message;
        }

        //If there is a photo, try to enhance it.
        if(photoAvailable){
                //Enhance photo for worker. This is the opportunity to make any improvement or to scan photo with
                //API capabilities, to ensure photo is appropirate
                //Image overlay => 3rd party API
                //cd to to node root folder and run "npm install --save jimp"
                var Jimp = require('jimp');
                //Commented - photo is stored in base64 format.
                //var base64image= Buffer.from(photo).toString("base64");
                var base64image=photo;
                let base64_Modified_image='';
                //enhance the image
                try
                {
                        let objPromise =  enhancePhotoPromise(base64image);
                        base64_Modified_image = await objPromise;
                        base64_Modified_image = base64_Modified_image.split(",")[1];
                        enhancedPhoto = true;
                }
                catch(err)
                {
                        console.log("Error: Trying to enhance photo. Message =>" + err.message);
                        enhancedPhoto = false;
                        return "Error: Unable to enhance photo. Message=>" + err.message;
                }
        }

        //If there is an enhanced photo to upload, proceed. Otherwise, something went wrong, skip the current new hire.
        if(enhancedPhoto)
        {
                // If there is an enhanced photo, let's update it.

                //Get employee ID from HCM using Worker REST API
                //Get URL with internal identifier for the specific new hire.
                var workerInternalId= '';

                try {
                        let http_promise = getWorkerInfoPromise(newhire.PersonNumber,cfg,input.hcmhostname,hcmcredential);
                        let response_body = await http_promise;

                        // holds response from server that is passed when Promise is resolved
                        workerInternalId=JSON.parse(response_body).items[0].links[0].href.split("/")[7];
                }
                catch(err) {
                        // Promise rejected
                        console.log("Error: Unable to get more info about worker. Message=>" + err.message);
                        return "Error: Unable to get more info about worker. Message=>" + err.message;
                }

                //Check whether worker has an existing profile photo
                var photoId=0;

                try {
                        let http_promise = isThereAProfilePhotoPromise(workerInternalId,cfg,input.hcmhostname,hcmcredential);
                        let response_body = await http_promise;

                        //If there is a a photo in collection, then there is an existing profile photo
                        //There can be only one profile photo
                        if(JSON.parse(response_body).count> 0)
                        photoId=JSON.parse(response_body).items[0].PhotoId;
                }
                catch(err) {
                        // Promise rejected
                        console.log("Error: Unable to determine existence of a profile photo. Message=>" + err.message);
                        return "Error: Unable to determine existence of a profile photo. Message=>" + err.message;
                }

                //If there is an existing profile photo in HCM, then delete. Only one profile photo can exist.
                if(photoId > 0)
                {
                        //deleteProfilePhoto(workerInternalId,photoId);
                        try {
                                let http_promise = deleteProfilePhotoPromise(workerInternalId,photoId,cfg,input.hcmhostname,hcmcredential);
                                let response_body = await http_promise;

                                console.log("Deleted existing photo");
                        }
                        catch(err) {
                                // Promise rejected
                                console.log("Error: Unable to delete existing profile photo. Message=>" + err.message);
                                return "Error: Unable to delete existing profile photo. Message=>" + err.message;
                        }

                }
                //Create profile photo in HCM
                //Call HCM REST API
                try {
                        let http_promise = addPhotoPromise(workerInternalId,base64_Modified_image,cfg,input.hcmhostname,hcmcredential);
                        let response_body = await http_promise;
                }
                catch(err) {
                        console.log("Error: Unable to add profile photo. Message=>" + err.message);
                        return "Error: Unable to add profile photo. Message=>" + err.message;
                }

                //If we reached this point, we've succeeded with the operation
                return "Completed";

        }

}

//Enhance the photo by adding a text overlap. This function can be modified for more capabilities
function enhancePhotoPromise(base64image) {

        return new Promise((resolve, reject) => {

                const Jimp = require('jimp');
                Jimp.read(Buffer.from(base64image,'base64'), async (err, image) => {
                        if (err) throw err;
                        const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
                        image
                        .print(font,25,175,"COMPANY LOGO")
                        .getBase64(Jimp.AUTO, (err, res)=>{base64_Modified_image=res;});
                        resolve(base64_Modified_image.toString());
                });
        }
)}

//Get more information about worker, so that internal identifier for URL can be determined
function getWorkerInfoPromise(personNumber,cfg,hcmhostname,hcmcredential) {

        return new Promise((resolve, reject) => {
                const https = require('https');

                const options = {
                        hostname: hcmhostname,
                        port: 443,
                        path: '/hcmRestApi/resources/11.13.18.05/workers?q=PersonNumber=' + personNumber,
                        method: 'GET',
                        headers: {
                                'Authorization': hcmcredential
                        }
                }
                https.get(options, (response) => {
                        let chunks_of_data = [];

                        response.on('data', (fragments) => {
                                chunks_of_data.push(fragments);
                        });

                        response.on('end', () => {
                                let response_body = Buffer.concat(chunks_of_data);
                                resolve(response_body.toString());
                        });

                        response.on('error', (error) => {
                                reject(error);
                        });
                });
        });
}

//POST to photo endpoint, to add a profile photo
function addPhotoPromise(workerInternalId,photoImage,cfg,hcmhostname,hcmcredential) {
        return new Promise((resolve, reject) => {
                const https = require('https');

                const data = JSON.stringify({
                        "PhotoType": "PROFILE",
                        "Photo": photoImage
                })
                const options = {
                        hostname: hcmhostname,
                        port: 443,
                        path: "/hcmRestApi/resources/11.13.18.05/workers/" + workerInternalId + '/child/photos',
                        method: 'POST',
                        headers: {
                                'Authorization': hcmcredential,
                                'Content-Type': 'application/json',
                                'Content-Length': data.length
                        }
                }
                const req = https.request(options, (response) => {
                        let chunks_of_data = [];

                        response.on('data', (fragments) => {
                                chunks_of_data.push(fragments);
                        });

                        response.on('end', () => {
                                let response_body = Buffer.concat(chunks_of_data);
                                resolve(response_body.toString());
                        });

                        response.on('error', (error) => {
                                reject(error);
                        });
                });

                req.on('error', error => {
                        console.error(error)
                })

                req.write(data)
                req.end()
        });
}

//Determine whether there is an existing profile photo
function isThereAProfilePhotoPromise(workerInternalId,cfg,hcmhostname,hcmcredential) {

        return new Promise((resolve, reject) => {
                const https = require('https');

                const options = {
                        hostname: hcmhostname,
                        port: 443,
                        path: "/hcmRestApi/resources/11.13.18.05/workers/" + workerInternalId + '/child/photos?q=PhotoType="PROFILE"',
                        method: 'GET',
                        headers: {
                                'Authorization': hcmcredential
                        }
                }
                https.get(options, (response) => {
                        let chunks_of_data = [];

                        response.on('data', (fragments) => {
                                chunks_of_data.push(fragments);
                        });

                        response.on('end', () => {
                                let response_body = Buffer.concat(chunks_of_data);
                                resolve(response_body.toString());
                        });

                        response.on('error', (err) => {
                                reject(err);
                        });
                });
        });
}

//Delete the existing profile photo.
function deleteProfilePhotoPromise(workerInternalId,photoId, cfg,hcmhostname,hcmcredential) {
        return new Promise((resolve, reject) => {
                const https = require('https');

                const options = {
                        hostname: hcmhostname,
                        port: 443,
                        path: "/hcmRestApi/resources/11.13.18.05/workers/" + workerInternalId +'/child/photos/' + photoId,
                        method: 'DELETE',
                        headers: {
                                'Authorization': hcmcredential
                        }
                }

                const req = https.request(options, (response) => {
                        let chunks_of_data = [];

                        response.on('data', (fragments) => {
                                chunks_of_data.push(fragments);
                        });

                        response.on('end', () => {
                                let response_body = Buffer.concat(chunks_of_data);
                                resolve(response_body.toString());
                        });

                        response.on('error', (err) => {
                                reject(err);
                        });
                });

                req.on('error', err => {
                        console.error(err)
                })
                req.end()

        });
}

module.exports = {
        hcmapi : hcmapi
}

