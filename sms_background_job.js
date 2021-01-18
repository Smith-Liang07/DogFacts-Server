var Parse = require('parse/node');
var _ = require('underscore');
var assert = require('assert-plus');
const dotenv = require('dotenv');
dotenv.config();

Parse.initialize(process.env.APP_ID,'',process.env.MASTER_KEY);
Parse.serverURL = process.env.SERVER_URL;

var pricePerSMS = 1;
var defaultPhoneNumber = process.env.DEFAULT_PHONE_NUMBER;
var twilioAccountId = process.env.TWILIO_ACCOUNT_ID;
var twilioAccessToken = process.env.TWILIO_ACCESS_TOKEN;

assert.string(defaultPhoneNumber, 'defaultPhoneNumber');
assert.string(twilioAccountId, 'twilioAccountId');
assert.string(twilioAccessToken, 'twilioAccessToken');

var twilioClient = require('twilio')(twilioAccountId, twilioAccessToken);

var Contact = Parse.Object.extend("Contact");
var Credit = Parse.Object.extend("Credit");
var Message = Parse.Object.extend("Message");
var Fact = Parse.Object.extend("Fact");

function runBackgroundJob() {
    console.log('***** SMS background job running *****');
   
    var numberFacts = 0;
    new Parse.Query(Fact)
        .count({useMasterKey: true}).then(function(count) {
            numberFacts = count;

            var underDateTrue = contactQuery()
                .lessThan("lastMessageDate", yesterday());

            var underLimitTrue = contactQuery()
                .equalTo("isDailyFactsUnderLimit", true);
        
            var underLimitExist = contactQuery()
                .doesNotExist("isDailyFactsUnderLimit");

            var combinedContactQuery = Parse.Query.or(underLimitTrue, 
                underLimitExist, underDateTrue);

            var creditQuery = new Parse.Query(Credit)
                .greaterThan("numberCredits", 0)
                .matchesQuery("contact", combinedContactQuery)
                .limit(1000)
                .include("contact")
                .include("contact.lastMessage")
                .include("contact.lastMessage.fact");
   
            return creditQuery.find({useMasterKey: true});
        }).then(function(credits) {
            console.log('credits', credits.length);
   
            var smsPromises = [];
            _.each(credits, function(credit) {
                var contact = credit.get("contact");
                var latestSentMessage = contact.get("lastMessage");
                var priority = latestSentMessage == null ? 0 : latestSentMessage.get("fact").get("priority");
                var nextFactIndex = (priority + 1) % numberFacts;

                smsPromise = new Parse.Query(Fact)
                    .equalTo("priority", nextFactIndex)
                    .first({useMasterKey: true})
                    .then(function(fact) {
                        console.log("Sending fact " + priority + " to " + contact.id);
                        return sendSMS(credit, fact);
                    }, function(error) {
                        console.error('sendSms error:', error);
                        return Parse.Promise.as(error);
                    });

                smsPromises.push(smsPromise);
            });
   
            return Parse.Promise.when(smsPromises);
        }).then(function() {
            console.log("Background job: Sucessfully sent messages");
            res.success("Sucessfully sent messages");
        }, function(error) {
            console.error("Background job error:",error);
            res.error(error);
        }); 
}

function contactQuery() {
    var dne = baseContactQuery()
        .doesNotExist("isBlacklisted");

    var blackListFalse = baseContactQuery()
        .equalTo("isBlacklisted", false);

    return Parse.Query.or(dne, blackListFalse);
}

function baseContactQuery() {
    return new Parse.Query(Contact)
        .equalTo("isActive", true)
        .greaterThan("numberFactsSentPerDay", 0);
}

function yesterday() {
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
}

function sendSMS(credit, fact) {
    var contact = credit.get("contact");
   
    var smsPromise = new Parse.Promise();
    setTimeout(function() {
        twilioClient.sendMessage({
            to: contact.get("phoneNumber"), // Any number Twilio can deliver to
            from: defaultPhoneNumber, // A number you bought from Twilio and can use for outbound communication
            body: fact.get("contents") // body of the SMS message
        }, function(err, responseData) { //this function is executed when a response is received from Twilio
            if (!err) { // "err" is an error received during the request, if any
                console.log(responseData);
                smsPromise.resolve();
            } else{
                console.error(err);
                smsPromise.reject(err);
            }
        });
    }, Math.random() * 4000); // Try to prevent too many concurrent twilio connections
    
    var message;
    return smsPromise.then(function() {
            message = new Message();
            message.set("contact", contact);
            message.set("fact", fact);
            return message.save(null, {useMasterKey: true});
        }, function(error) {
            contact.set("isBlacklisted", true);
            return contact.save(null, {useMasterKey: true});
        }).then(function(savedMessage) {
            message = savedMessage;

            var previousCredits = credit.get("numberCredits");
            credit.set("numberCredits", previousCredits - pricePerSMS);
            return credit.save(null, {useMasterKey: true});
        }).then(function(credit) {
            contact.set("numberCredits", credit.get("numberCredits"));
            contact.set("lastMessage", message);
            contact.set("lastMessageDate", message.createdAt);

            numberFactsSentPerDay = contact.get("numberFactsSentPerDay");
            prevFacts = contact.get("factsSentToday");
            if(prevFacts == null || prevFacts >= numberFactsSentPerDay) {
                prevFacts = 0;
            }

            contact.set("factsSentToday", prevFacts + 1);
            contact.set("isDailyFactsUnderLimit", (prevFacts + 1) < numberFactsSentPerDay);
            return contact.save(null, {useMasterKey: true});
        });
}

runBackgroundJob();