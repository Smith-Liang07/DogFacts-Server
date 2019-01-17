var iap = require('iap');
var _ = require('underscore');

var prodUrl = 'https://buy.itunes.apple.com/verifyReceipt';
var sandboxUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
var wrongEnvironmentErrorCode = 21007;

Parse.Cloud.define("validatePurchase", function(request, response) {
    validatePurchase(request, response, prodUrl, function(err) {
        validatePurchase(request, response, sandboxUrl, function(err) {
           response.error("APPLE_SERVER_NOT_RESPONDING");
        });
    });
});

Parse.Cloud.define("validatePurchaseAndroid", function(request, response) {
    validatePurchaseAndroid(request, response, prodUrl, function(err) {
        validatePurchaseAndroid(request, response, sandboxUrl, function(err) {
           response.error("GOOGLE_SERVER_NOT_RESPONDING");
        });
    });
});

Parse.Cloud.beforeSave("Contact", function (request, response) {
    var contact = request.object;
    //if (contact.isNew()) {
    contact.set("strippedNumber", 
        contact.get("phoneNumber").replace(/[\+\(\)\s-]+/g, ""));
    //}

    response.success();
});

Parse.Cloud.afterSave("Message", function(request) {
    console.log("Message saved!");

    var Conversation = Parse.Object.extend("Conversation");
    var contact = request.object.get("contact");
    var fact = request.object.get("fact");

    contact
        .fetch({ useMasterKey: true })
        .then(function(updatedContact) {
            contact = updatedContact;
            return fact.fetch({ useMasterKey: true });
        })
        .then(function(fact) {
            var factContents = fact.get("contents");

            var newConvo = new Conversation({
                "contact": contact,
                "message": factContents,
                "isContactResponse": false
            });

            var contactOwner = contact.get("parent").id;

            var acl = new Parse.ACL();
            acl.setPublicReadAccess(false);
            acl.setPublicWriteAccess(false);
            acl.setReadAccess(contactOwner, true);

            newConvo.setACL(acl);
            newConvo.save(null, { useMasterKey: true });
        });
});

// Needs authorisation
//GET https://www.googleapis.com/androidpublisher/v2/applications/packageName/purchases/products/productId/tokens/token
function validatePurchase(request, response, url, err) {    
    var receipt = request.params.receipt;
    var transactionId = "";
    var productId = "";
    var ContactClass = Parse.Object.extend("Contact");
    var contact = new ContactClass();
    contact.id = request.params.contactId;
    
    var credits = 0;
    
    var user = request.user;
    var validationParams = {"receipt-data":receipt};
    var receiptValidPromise = new Parse.Promise();
    var transactionValidPromise = new Parse.Promise();
    
    Parse.Cloud.httpRequest({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        url: url,
        body: validationParams,
        success: function(httpResponse) {
            var responseJson = JSON.parse(httpResponse.text);
            if(responseJson["status"] != wrongEnvironmentErrorCode) {
                transactionId = responseJson.receipt.in_app[0].transaction_id;
                productId = responseJson.receipt.in_app[0].product_id;

                if(responseJson.status != null){
                    if(responseJson.status == 0){
                        receiptValidPromise.resolve();
                    }
                    else{
                        console.error("RECEIPT_VALIDATION_STATUS: " + responseJson.status)
                        response.error("RECEIPT_PROBLEM");
                    }
                }
            } else {
                err();
            }
        },
        error: function(httpResponse) {
            console.error(httpResponse);
            err();
        }
    }); 
    receiptValidPromise.then(function(){
            
        var transactionQuery = new Parse.Query("Transaction")
            .equalTo("user",user)
            .equalTo("transactionId",transactionId);
        return transactionQuery.find({ useMasterKey: true });
    
    }).then(function(transactions){
    
        var transactionPromise = new Parse.Promise();
        var productPromise = new Parse.Promise();
    
        console.error("Transactions found " + transactions.length);
        if(transactions.length == 0){
            var TransactionClass = Parse.Object.extend("Transaction");
            var transaction = new TransactionClass();
            transaction.set("user",user);
            transaction.set("transactionId",transactionId);
            transaction.save(null, { useMasterKey: true }).then(function(){
                transactionPromise.resolve();
            });
        }
        else{
            return Parse.Promise.error("RECEIPT_ALREADY_USED");
        }
    
        // Here in parallel we can find how many credits the productId maps to
        var productQuery =  new Parse.Query("Product")
            .equalTo("productId",productId);
            productQuery.find({ useMasterKey: true }).then(function(products){
                //console.error(products.length + " products found with ID " + productId);
                credits = products[0].get("credits");
                productPromise.resolve();
            });
    
        return Parse.Promise.when([transactionPromise, productPromise]);
            
    
    }).then(function(){
    
        var creditQuery =  new Parse.Query("Credit")
            .equalTo("contact",contact);
        return creditQuery.find({ useMasterKey: true });
    
    }).then(function(creditsResult){
    
        if(creditsResult.length == 0){
            var CreditClass = Parse.Object.extend("Credit");
            var credit = new CreditClass();
            credit.set("contact",contact);
            credit.set("numberCredits",credits);
            return credit.save(null, { useMasterKey: true });
        }
        else{
            creditsResult[0].increment("numberCredits",credits);
            return creditsResult[0].save(null, { useMasterKey: true });
        }
    
    }).then(function(){
    
        contact.increment("numberCredits", credits);
        return contact.save(null, { useMasterKey: true });
    
    }).then(function(){
        response.success("OK");
    },function(error){
        response.error(error);
    });
}

function validatePurchaseAndroid(request, response, url, err) {    
    //Parse.Cloud.useMasterKey();
    var receipt = request.params.receipt;
    var transactionId = request.params.transactionId;
    var productId = request.params.productId;
    var ContactClass = Parse.Object.extend("Contact");
    var contact = new ContactClass();
    contact.id = request.params.contactId;
    
    var credits = 0;
    
    var user = request.user;
    var validationParams = {"receipt-data":receipt};
    var receiptValidPromise = new Parse.Promise();
    var transactionValidPromise = new Parse.Promise();
    
    receiptValidPromise.resolve();
    receiptValidPromise.then(function(){
            
        var transactionQuery = new Parse.Query("Transaction")
            .equalTo("user",user)
            .equalTo("transactionId",transactionId);
        return transactionQuery.find({ useMasterKey: true });
    
    }).then(function(transactions){
    
        var transactionPromise = new Parse.Promise();
        var productPromise = new Parse.Promise();
    
        console.error("Transactions found " + transactions.length);
        if(transactions.length == 0){
            var TransactionClass = Parse.Object.extend("Transaction");
            var transaction = new TransactionClass();
            transaction.set("user",user);
            transaction.set("transactionId",transactionId);
            transaction.save(null, { useMasterKey: true }).then(function(){
                transactionPromise.resolve();
            });
        }
        else{
            return Parse.Promise.error("RECEIPT_ALREADY_USED");
        }
    
        // Here in parallel we can find how many credits the productId maps to
        var productQuery =  new Parse.Query("Product")
            .equalTo("productId",productId);
            productQuery.find({ useMasterKey: true }).then(function(products){
                //console.error(products.length + " products found with ID " + productId);
                credits = products[0].get("credits");
                productPromise.resolve();
            });
    
        return Parse.Promise.when([transactionPromise, productPromise]);
            
    
    }).then(function(){
    
        var creditQuery =  new Parse.Query("Credit")
            .equalTo("contact",contact);
        return creditQuery.find({ useMasterKey: true });
    
    }).then(function(creditsResult){
    
        if(creditsResult.length == 0){
            var CreditClass = Parse.Object.extend("Credit");
            var credit = new CreditClass();
            credit.set("contact",contact);
            credit.set("numberCredits",credits);
            return credit.save(null, { useMasterKey: true });
        }
        else{
            creditsResult[0].increment("numberCredits",credits);
            return creditsResult[0].save(null, { useMasterKey: true });
        }
    
    }).then(function(){
    
        contact.increment("numberCredits", credits);
        return contact.save(null, { useMasterKey: true });
    
    }).then(function(){
        response.success("OK");
    },function(error){
        response.error(error);
    });
}


Parse.Cloud.define('validateAndroidPurchase', function(req, res) {
  
  var productId = req.params.productId;
  var receipt = req.params.receipt;

  // -- Product Ids:
  //com.mjm.catfacts.creditpack10
  //com.mjm.catfacts.creditpack20
  //com.mjm.catfacts.creditpack30
  //com.mjm.catfacts.creditpack40
  //com.mjm.catfacts.creditpack50

    var platform = 'google';
    var payment = {
        receipt: receipt,   // always required
        productId: productId,
        packageName: 'com.app.dogfacts',
        keyObject: {
          type: "service_account",
          project_id: "dogfacts-1348",
          private_key_id: "37d3d748521f5827ebd29c2c3c64bfecb4e117f3",
          private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5qZa25ZNIIjKf\nDewqDEMvyecdbzTe6aOzhcz663Jdk0X/cBthjjiLA4rNe5ls5VGYvLXzIobd/QTd\nO0ab3+ncFco33v/ssWKbwVXVI49TSVV6LXPrqly46pdOWhguVOOjR98M/8sh4JcF\nCGv1O/Gb1CdJMyTKXk2hVgdMWk90vNiyIFP4ubi8S5/ocVHW0Jd5BmX3Ip0E65P4\n9kbRog3AZaiL8UZL/PdqPG6kYVDNIM7j5EE2MaIXakrt1D+4CChPc9iD8yj7jy07\nMDzIj08LBbGr9Z6hvZXQsrx6sWQcMnnJ5B73TGD9WBFJZ23zSx3wIcW7HjfcIbM9\nTmriY/yDAgMBAAECggEBAKTZTXbL1MABjUzogb678JPoA4uBCEK81Js7vEs27u7j\nKw2pLsaqDs5vsLjOe+XSn2aseCmPiIxmcgE09nbEk9LUjh6ZpEc3IUUGnv2Ge2YK\nARlgbkLbm0SdFwd8u2e3+/8oe4YBQQ2taqoPVjwCo34nG1LFVG9S2D7eMdC7hz0w\nRViERnZAigrfkAIiCsxGi98drY/8moGtBkKAU1eqq76eBl2P5aRpnNyZtA6bTmoV\nubzKWc77ebhQVZhAU/WB3SsxBYSiuMHfq3EJkZ1AsscoeEkFhANtg/RnnGoIBtMZ\npGbsUe5QAeJHmHAlqoGaE98WCpv+bPPZvpwU5tlJENECgYEA2rdQlwtN8rQi4OUo\npRgCE2E1BtU2BPeLVtTKDsSQM1jfwEwR/OR1hj0cOs8Z9/SJFlwIaVU3HXXna30A\nbc7Sh3Bi1Koq0Dzfd8alfeu9wA1lGCCtNMahcMDp373S/qLFA2WiCruczO586jTo\nc2eSTa+E38W+LNGtBOhVETFUbMcCgYEA2U/TqG7LKN73EH/fx9gY5CsQD0/GGOHr\nwJaN14dWWGWh4goVj53/Jwc1naMKYn3//ujkIQsguB9Hzp+sILjjMJgxDFfQpYUv\nP/iW4E2VCB+50cm6guSdW3k7HE92hfIS/KrEqqCrZehCGFNfG1DLRo4xJCOibzaq\nn8nQoCa8XmUCgYA6PFk+/omQuBoZW6sI2m2jD1z5JsgtZmQ5iIsMh5YFtgJNx3N6\nrLIGPjtIBWDavsfJplOvCDuWopAt9KiqlElGOsx156FitPKjh8cE0kJB4s8qL3ku\n9jyCMzuSkY6esmRW1TbiOLY1csLb8Z57K/aurK9qjdJnSKUTC3GrFEFwfQKBgEI9\ntA4On7z4oiUUZZlcRNIgUkfokED7dMqC2f/N0EMnz73ARyw9BA7Ygr5neX3mXIdO\nZGOyKaoWVuQkBer/kLk6WxEhH4ek3m9Ijm0XGQud6B2LuV+24kSE4sDRdBaGYMVG\nJKbCTRzGPId/umjwKtZ5937Fofj2l/IXKZH33MmFAoGBALPmbffTSCp/bOg2BuQ/\n5AA5WRPTeebXsNjTbj1lAHSgZ6ylbPywL/VBfVA5lBYhat9H2BtgpIiMKTSVm2D/\ndE0BfYRI/81WoBBN3ta8coAi2kMzUx+6o5CXco/+IvjR0yYkiTRbYIxvTVpgPTiR\nNkq9BAdIcjuSKrA5iW/d3UYy\n-----END PRIVATE KEY-----\n",
          client_email: "purchase-validator@dogfacts-1348.iam.gserviceaccount.com",
          client_id: "111848082510135180444",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://accounts.google.com/o/oauth2/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/purchase-validator%40dogfacts-1348.iam.gserviceaccount.com"
        }
    };

    iap.verifyPayment(platform, payment, function (error, response) {
       console.log('error',error);
       console.log('response',response);
        res.success("error: " + JSON.stringify(error) + " success: " + JSON.stringify(response));
        
        
    });
});