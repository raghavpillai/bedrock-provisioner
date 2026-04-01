export const BEDROCK_POLICY_ARN =
  "arn:aws:iam::aws:policy/AmazonBedrockFullAccess";

export const BEDROCK_SERVICE_NAME = "bedrock.amazonaws.com";

export const USER_PREFIX = "bedrock-key-";

// All AWS regions where Bedrock is available
export const ALL_BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
] as const;

export const EXPIRY_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "5 days", days: 5 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "365 days", days: 365 },
  { label: "Never expires", days: 0 },
  { label: "Custom", days: -1 },
] as const;
