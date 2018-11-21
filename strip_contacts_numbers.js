const Parse = require('parse/node');

Parse.initialize(process.env.APP_ID, '', process.env.MASTER_KEY);
Parse.serverURL = process.env.SERVER_URL;

const contactQuery = new Parse.Query('Contact');
contactQuery.exists('phoneNumber');
contactQuery.doesNotExist('strippedNumber');

const stripNumber = object => {
  object.set('strippedNumber', object.get('phoneNumber').replace(/\D/g, ''));
  return object.save(null, { useMasterKey: true });
};

const updateNumbersBlock = count =>
  list => {
    if (list.length) {
      count -= list.length;
      console.log(`${count} not stripped contacts numbers left`);
      Promise
        .all(list.map(stripNumber))
        .then(() => stripNumbers(count));
    } else {
      console.log('All numbers stripped');
    }
  };

const stripNumbers = count => {
  contactQuery.find({ useMasterKey: true })
    .then(updateNumbersBlock(count));
};

contactQuery.count({ useMasterKey: true })
  .then(count => stripNumbers(count));


