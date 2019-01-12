var Parse = require('parse/node');
var _ = require('underscore');

Parse.initialize(process.env.APP_ID,'',process.env.MASTER_KEY);
Parse.serverURL = process.env.SERVER_URL;

var pricePerSMS = 1;
var defaultPhoneNumber = "+12132635399";

var TWILIO_ACCOUNT_ID = 'AC8353b9970b09f86423335e8dadd0e001';
var TWILIO_ACCESS_TOKEN = '89b6cd83b66c2a2f4b6f2cecb14b0cee';

function runBackgroundJob() {
    console.log('***** Dog facts job running');

    var Contact = Parse.Object.extend("Contact");
    var Credit = Parse.Object.extend("Credit");
    var Message = Parse.Object.extend("Message");
    var Fact = Parse.Object.extend("Fact");
   
    var numberFacts = 0;
    new Parse.Query(Fact)
        .count({useMasterKey: true}).then(function(count) {
            numberFacts = count;

            var contactQuery = new Parse.Query(Contact)
                .equalTo("isActive", true)
                .equalTo("isBlacklisted", false)
                .greaterThan("numberFactsSentPerDay", 0);
   
            var creditQuery = new Parse.Query(Credit)
                .greaterThan("numberCredits", 0)
                .matchesQuery("contact", contactQuery)
                .limit(1000)
                .include("contact");
   
            return creditQuery.find({useMasterKey: true});
        }).then(function(credits) {
            console.log('credits', credits.length);
            var todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
   
            var todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);
   
            var smsPromises = [];
            _.each(credits, function(credit) {
                var contact = credit.get("contact");
		        var latestSentMessage;
                var smsPromise =  new Parse.Query(Message)
                    .equalTo("contact", contact)
                    .greaterThan("createdAt", todayStart)
                    .lessThan("createdAt", todayEnd)
                    .addDescending("createdAt")
                    .include("fact")
                    .find({useMasterKey: true})
                    .then(function(latestSentMessages) {
                        if(latestSentMessages.length < contact.get("numberFactsSentPerDay")) {
                            // Fetch the last message ever sent to the user
                            return new Parse.Query(Message)
                                .equalTo("contact", contact)
                                .addDescending("createdAt")
                                .include("fact")
                                .limit(1)
                                .find({useMasterKey: true})
                                .then(function(latestMessages) {
                                    var priority = latestMessages.length > 0 ? latestMessages[0].get("fact").get("priority") : 0;
                                    var nextFactIndex = (priority + 1) % numberFacts;
                                    return new Parse.Query(Fact)
                                        .equalTo("priority", nextFactIndex)
                                        .first({useMasterKey: true});
                                });
                            
                        } else {
                            return Parse.Promise.error("Already filled up the user's quota");
                        }
                    }).then(function(fact) {
                        console.log("Sending fact: " + fact.get("contents"));
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

function sendSMS(credit, fact) {
    var twilioClient = require('twilio')(TWILIO_ACCOUNT_ID, TWILIO_ACCESS_TOKEN);
    var Message = Parse.Object.extend("Message");
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
    }, Math.random() * 10000); // Try to prevent too many concurrent twilio connections
           
    return smsPromise.then(function() {
            var message = new Message();
            message.set("contact", contact);
            message.set("fact", fact);
            return message.save(null, {useMasterKey: true});
        }, function(error) {
            contact.set("isBlacklisted", true);
            return contact.save(null, {useMasterKey: true});
        }).then(function(savedMessage) {
            var previousCredits = credit.get("numberCredits");
            credit.set("numberCredits", previousCredits - pricePerSMS);
            return credit.save(null, {useMasterKey: true});
        }).then(function(credit) {
            contact.set("numberCredits", credit.get("numberCredits"));
            return contact.save(null, {useMasterKey: true});
        });
}

runBackgroundJob();