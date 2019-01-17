var bodyParser = require('body-parser');

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');

var smsResponseWebhook = require('./sms_response_webhook');
var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
}

var api = new ParseServer({
  databaseURI: databaseUri || 'mongodb://localhost:27017/dev',
  cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
  appId: process.env.APP_ID || 'myAppId',
  masterKey: process.env.MASTER_KEY || '', 
  serverURL: process.env.SERVER_URL || 'http://localhost:1337/parse', 
  push: {
  ios: [
    {
      pfx: './p12/apns_dev.p12', // Prod PFX or P12
      bundleId: 'com.mjm.dogfactstexts',
      production: false // Prod
    }
  ]
  }
});

var app = express();

// Configure body parser
app.use(bodyParser.urlencoded({ extended: false }));

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  res.status(200).send('Make sure to star the parse-server repo on GitHub!');
});

// SMS response webhook
app.post('/api/sms-response', smsResponseWebhook);

var port = process.env.PORT || 1337;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server running on port ' + port + '.');
});
