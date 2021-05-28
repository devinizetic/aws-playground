const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient(),
  S3 = new AWS.S3();

const GET_LABELS_ACTION = "getLabels";
const DELETE_IMAGE_ACTION = "deleteImage";

exports.handler = async function (event, context) {
  console.log("Service Lambda processing event: ", event);
  const action = event.action;
  const image = event.key;

  const imageRequest = {
    key: image,
  };

  if (action == GET_LABELS_ACTION) {
    const labelResult = await getLabels(imageRequest);
    if (labelResult && labelResult.image) return labelResult;
    return "No results";
  }

  if (action == DELETE_IMAGE_ACTION) {
    const deleteResult = await deleteImage(imageRequest);
    return deleteResult;
  }

  throw new Error("Action not detected or recognised");
};

const getLabels = async (imageRequest) => {
  const key = imageRequest.key;
  const imageLabelsTable = process.env.TABLE;
  try {
    var params = {
      TableName: imageLabelsTable,
      Key: {
        image: key
      },
    };
    const response = await dynamodb.get(params).promise();
    return response.Item;
  } catch (err) {
    console.log(err);
    return "No labels or error";
  }
};

const deleteImage = async (imageRequest) => {
  const key = imageRequest.key;
  const imageLabelsTable = process.env.TABLE;
  try {
    var params = {
      TableName: imageLabelsTable,
      Key: {
        image: key
      },
    };
    await dynamodb.delete(params).promise();
  } catch (err) {
    console.log(err);
  }

  const imagesBucket = process.env.BUCKET;
  const resizedImagesBucket = process.env.THUMBBUCKET;

  try {
    var imagesParams = {
      Bucket: imagesBucket,
      Key: key,
    };
    await S3.deleteObject(imagesParams).promise();
    var resizedParams = {
      Bucket: resizedImagesBucket,
      Key: key,
    };
    await S3.deleteObject(resizedParams).promise();
  } catch (err) {
    console.log(err);
  }

  return "Delete request successfully processed";
};
