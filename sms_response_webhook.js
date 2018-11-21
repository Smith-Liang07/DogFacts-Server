const Parse = require('parse/node');
const twilio = require('twilio');

Parse.initialize(process.env.APP_ID, '', process.env.MASTER_KEY);
Parse.serverURL = process.env.SERVER_URL;

const Conversation = Parse.Object.extend('Conversation');
const Contact = Parse.Object.extend('Contact');
const accountSids = (process.env.ACCOUNT_SIDS || '').split(' ');

const emptyTwiML = new twilio.TwimlResponse().toString();

const createAcl = contact => {
  const contactOwner = contact.get('parent').id;
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  acl.setWriteAccess(contactOwner, true);
  acl.setReadAccess(contactOwner, true);
  return acl;
};

const saveResponse = (contact, message) => {
  const conversation = new Conversation();
  conversation.set('contact', contact);
  conversation.set('message', message);
  conversation.set('isContactResponse', true);
  conversation.setACL(createAcl(contact));

  conversation.save(null, { useMasterKey: true })
    .then(() => { // noop
      },
      err => {
        console.error(`SMS response wasn't created!`);
        console.error(err);
      });
};

const addResponse = (body, strippedNumber) => contacts => {
  if (contacts.length) {
    contacts.forEach(contact => saveResponse(contact, body.Body));
  } else {
    console.error(body);
    console.error(`Phone number ${strippedNumber} not found!`);
  }
};

module.exports = (req, res) => {
  if (accountSids.includes(req.body.AccountSid)) {
    const strippedNumber = req.body.From.substr(2);
    const contactQuery = new Parse.Query('Contact');
    contactQuery.matches('strippedNumber', `\d*${strippedNumber}`);
    contactQuery.find({
      useMasterKey: true,
      success: addResponse(req.body, strippedNumber)
    });
  } else {
    console.error(`Wrong AccountSid ${req.body.AccountSid}, expected one of ${accountSids}!`);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.header('Content-Type', 'text/xml').send(emptyTwiML);
};

if (!accountSids.find(accountSid => accountSid)) {
  console.error(`accountSids aren't defined in environment variable!`);
}
