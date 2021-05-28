const AWS = require("aws-sdk");
const Jimp = require("jimp");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

const thumbBucket = process.env.THUMBBUCKET;
const minConfidence = 50;
const rekognition = new AWS.Rekognition(),
  dynamodb = new AWS.DynamoDB.DocumentClient(),
  S3 = new AWS.S3();

exports.handler = async function (event, context) {
  console.log("Lambda processing event: ", event);
  for (const record of event.Records) {
    const ourBucket = record.s3.bucket.name;
    const ourKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    await generateThumb(ourBucket, ourKey);
    await rekFunction(ourBucket, ourKey);
  }
  return;
};

const generateThumb = async (bucketName, bucketKey) => {
  const keyId = uuidv4();
  const downloadPath = `/tmp/${keyId}${bucketKey}`;
  const uploadPath = `/tmp/resized-${bucketKey}`;
  // Download file from s3 and store it in Lambda /tmp storage (512MB avail)
  try {
    const imageData = await downloadFile(bucketName, bucketKey);
    if (!imageData || !imageData.Body) {
      console.log("response Body is empty.");
      return;
    }
    fs.writeFileSync(downloadPath, imageData.Body);
    console.log(`${downloadPath} has been created!`);
  } catch (err) {
    console.log(err, err.stack);
  }

  //Create our thumbnail using Jimps library
  await resizeImage(downloadPath, uploadPath);
  try {
    const uploadedData = await uploadFileToThumbBucket(uploadPath, bucketKey);
    console.log(`File uploaded successfully. ${uploadedData.Location}`);
  } catch (err) {
    console.log(err, err.stack);
  }

  try {
    fs.unlinkSync(downloadPath);
    fs.unlinkSync(uploadPath);
  } catch (err) {
    console.log(err);
  }
};

const downloadFile = (bucketName, key) => {
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  return S3.getObject(params).promise();
};

const uploadFileToThumbBucket = (filePath, fileKey) => {
  // Read content from the file
  console.log(`reading => ${filePath}`);
  const fileContent = fs.readFileSync(filePath);

  // Setting up S3 upload parameters
  const params = {
    Bucket: thumbBucket,
    Key: fileKey,
    Body: fileContent,
  };

  // Uploading files to the bucket
  return S3.upload(params).promise();
};

const resizeImage = async (imagePath, resizedPath) => {
  console.log(`Jimp will read => ${imagePath}`);
  const myImage = await Jimp.read(imagePath);
  return myImage.cover(250, 250).quality(60).writeAsync(resizedPath);
};

const rekFunction = async (bucketName, bucketKey) => {
  console.log("Currently processing the following image");
  console.log(`Bucket: ${bucketName} key name: ${bucketKey}`);

  let detectLabelsResults = {};
  const params = {
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: bucketKey,
      },
    },
    MaxLabels: 10,
    MinConfidence: minConfidence,
  };

  try {
    detectLabelsResults = await rekognition.detectLabels(params).promise();
    console.log("Result: ", detectLabelsResults);
  } catch (err) {
    console.log(err, err.stack);
  }
  let objectsDetected = [];
  let imageLabels = {
    image: bucketKey,
  };

  //Add all of our labels into imageLabels by iterating over response['Labels']
  if (!detectLabelsResults || !detectLabelsResults.Labels) {
    console.log("No label result!!!");
    return;
  }

  for (let label of detectLabelsResults.Labels) {
    console.log("processing label: ", label);
    let newItem = label.Name;
    objectsDetected.push(newItem);
    let objectNum = objectsDetected.length;
    let itemAttr = `object${objectNum}`;
    console.log("item label => ", itemAttr);
    imageLabels[itemAttr] = newItem;
  }

  const imageLabelsTable = process.env.TABLE;
  let docParams = {
    TableName: imageLabelsTable,
    Item: imageLabels,
  };

  try {
    const dbResult = await dynamodb.put(docParams).promise();
    console.log("Added item:", JSON.stringify(dbResult, null, 2));
  } catch (err) {
    console.log(
      "Unable to add item. Error JSON:",
      JSON.stringify(err, null, 2)
    );
  }

  return;
};

//Clean the string to add the colon back into requested name
const replaceSubstringWithColon = (txt) => txt.replace("%3A", ":");
