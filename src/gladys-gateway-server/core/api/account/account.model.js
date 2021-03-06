const { AlreadyExistError, ForbiddenError, NotFoundError } = require('../../common/error');
const Promise = require('bluebird');
const crypto = require('crypto');
const randomBytes = Promise.promisify(require('crypto').randomBytes);

module.exports = function AccountModel(logger, db, redisClient, stripeService, mailgunService, selzService, slackService) {

  async function getUsers(user) {
    
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'account_id']});

    // get list of user with same account
    var users = await db.t_user.find({
      account_id: userWithAccount.account_id,
      is_deleted: false
    }, {fields: ['id', 'name', 'profile_url', 'email', 'role', 'created_at']});

    var usersNotAccepted = await db.t_invitation.find({
      account_id: userWithAccount.account_id,
      revoked: false,
      is_deleted: false,
      accepted: false
    }, {field: ['id', 'email', 'account_id', 'role', 'created_at']});

    var allUsers = [];

    users.forEach((user) => {
      user.is_invitation = false;
      allUsers.push(user);
    });

    usersNotAccepted.forEach((user) => {
      user.is_invitation = true;
      allUsers.push(user);
    });

    return allUsers;
  }

  async function subscribeMonthlyPlanWithoutAccount(rawEmail, language, sourceId){

    var email = rawEmail.trim().toLowerCase();
    var role = 'admin';

    // we first test if an account already exist with this email
    var account = await db.t_account.findOne({ name: email });

    // it means an account already exist with this email
    if (account !== null) {
      throw new AlreadyExistError();
    }
    
    // create the customer on stripe side
    var customer = await stripeService.createCustomer(email, sourceId);

    // contact stripe to save the subscription id
    var subscription = await stripeService.subscribeToMonthlyPlan(customer.id);

    // it means stripe is disabled
    // so we add to the account 100 years of life
    if(subscription === null) {
      subscription = {
        id: 'stripe-subcription-sample',
        current_period_end: new Date().getTime() + 100*365*24*60*60*1000
      };
    }

    var newAccount = {
      name: email,
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      current_period_end: new Date(subscription.current_period_end * 1000)
    };

    var insertedAccount = await db.t_account.insert(newAccount);

    // generate email confirmation token
    var token = (await randomBytes(64)).toString('hex');

    // we hash the token in DB so it's not possible to get the token if the DB is compromised in read-only
    // (due to SQL injection for example)
    var tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.t_invitation.insert({
      email,
      role,
      token_hash: tokenHash,
      account_id: insertedAccount.id
    });

    // we invite the user in slack if slack is enabled
    await slackService.inviteUser(email);

    // we create a selz discount
    const selzDiscount = await selzService.createDiscount(email);

    const selzDiscountUrl = (selzDiscount && selzDiscount.data)  ? selzDiscount.data.short_url : null;

    await mailgunService.send({ email, language }, 'welcome', {
      confirmationUrl: process.env.GLADYS_GATEWAY_FRONTEND_URL + '/signup?token=' + encodeURI(token),
      selzDiscountUrl
    });

    return insertedAccount;
  }

  async function subscribeMonthlyPlan(user, sourceId) {
    
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the account to verify the user has not already subscribed
    var account = await db.t_account.findOne({
      id: userWithAccount.account_id
    }, {fields: ['id', 'stripe_customer_id']});

    // account with stripe_customer_id already exist, don't make him subscribe again!
    if(account.stripe_customer_id) {
      throw new AlreadyExistError('Customer', account.id);
    }

    // create the customer on stripe side
    var customer = await stripeService.createCustomer(userWithAccount.email, sourceId);

    // contact stripe to save the subscription id
    var subscription = await stripeService.subscribeToMonthlyPlan(customer.id);

    // it means stripe is disabled
    // so we add to the account 100 years of life
    if(subscription === null) {
      subscription = {
        id: 'stripe-subcription-sample',
        current_period_end: new Date().getTime() + 100*365*24*60*60*1000
      };
    }

    var toUpdate = {
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      current_period_end: new Date(subscription.current_period_end * 1000)
    };

    var accountUpdated = await db.t_account.update(userWithAccount.account_id, toUpdate, {
      fields: ['id', 'current_period_end']
    });

    return accountUpdated;
  }

  async function updateCard(user, sourceId) {
    
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the account
    var account = await db.t_account.findOne({
      id: userWithAccount.account_id
    }, {fields: ['id', 'stripe_customer_id']});

    // update the customer on stripe side
    var customer = await stripeService.updateCard(account.stripe_customer_id, sourceId);

    return customer;
  }

  async function getCard(user) {
     
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the account
    var account = await db.t_account.findOne({
      id: userWithAccount.account_id
    }, {fields: ['id', 'stripe_customer_id', 'stripe_subscription_id']});

    // get card
    var results = await Promise.all([
      stripeService.getCard(account.stripe_customer_id),
      stripeService.getSubscription(account.stripe_subscription_id)
    ]);

    var card = results[0];
    
    // we add subscription cancellation 
    if (results[1]) {
      if(results[1].canceled_at) {
        card.canceled_at = new Date(results[1].canceled_at * 1000);
      } else {
        card.canceled_at = null;
      }
      card.current_period_end = new Date(results[1].current_period_end * 1000);
    }

    return card;
  }

  async function cancelMonthlySubscription(user) {
    
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the account
    var account = await db.t_account.findOne({
      id: userWithAccount.account_id
    }, {fields: ['id', 'stripe_customer_id', 'stripe_subscription_id']});

    return stripeService.cancelMonthlySubscription(account.stripe_subscription_id);
  }

  async function subscribeAgainToMonthlySubscription(user) {
    
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the account
    var account = await db.t_account.findOne({
      id: userWithAccount.account_id
    }, {fields: ['id', 'stripe_customer_id']});

    // contact stripe to save the subscription id
    var subscription = await stripeService.subscribeToMonthlyPlan(account.stripe_customer_id);

    // it means stripe is disabled
    // so we add to the account 100 years of life
    if(subscription === null) {
      subscription = {
        id: 'stripe-subcription-sample',
        current_period_end: new Date().getTime() + 100*365*24*60*60*1000
      };
    }

    var toUpdate = {
      stripe_subscription_id: subscription.id,
      current_period_end: new Date(subscription.current_period_end * 1000)
    };

    var accountUpdated = await db.t_account.update(userWithAccount.account_id, toUpdate, {
      fields: ['id', 'current_period_end']
    });

    return accountUpdated;
  }

  async function stripeEvent(body, signature) {
    var event = stripeService.verifyEvent(body, signature);

    console.log(event);

    var account;

    if(event.data && event.data.object && event.data.object.customer) {
      
      // we get the account linked to the customer
      account = await db.t_account.findOne({
        stripe_customer_id: event.data.object.customer
      });
    } else {
      return Promise.resolve();
    }

    if(!account) {
      logger.warn(`Stripe Webhook : Account with stripe customer "${event.data.object.customer}" not found.`);
      return Promise.resolve();
    }

    switch(event.type) {
    
    case 'charge.succeeded':

      // get currentPeriodEnd threw the API
      var currentPeriodEnd = await stripeService.getSubscriptionCurrentPeriodEnd(account.stripe_subscription_id);

      // update current_period_end in DB
      await db.t_account.update(account.id, {
        current_period_end: new Date(currentPeriodEnd*1000)
      }, {
        fields: ['id', 'current_period_end']
      });

      break;

    case 'invoice.payment_succeeded':
      
      var activity = {
        stripe_event: event.type,
        account_id: account.id,
        hosted_invoice_url: event.data.object.hosted_invoice_url,
        invoice_pdf: event.data.object.invoice_pdf,
        amount_paid: event.data.object.amount_paid,
        closed: event.data.object.closed,
        currency: event.data.object.currency,
        params: event
      };

      await db.t_account_payment_activity.insert(activity);

      break;

    case 'invoice.payment_failed':
      
      var activity = {
        stripe_event: event.type,
        account_id: account.id,
        hosted_invoice_url: event.data.object.hosted_invoice_url,
        invoice_pdf: event.data.object.invoice_pdf,
        amount_paid: event.data.object.amount_paid,
        closed: event.data.object.closed,
        currency: event.data.object.currency,
        params: event
      };

      await db.t_account_payment_activity.insert(activity);

      break;

    case 'customer.subscription.deleted':
      // subscription is canceled, remove the client
      break;
    } 
  }

  async function revokeUser(user, userIdToRevoke) {
     
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'role', 'account_id']});

    if(userWithAccount.role !== 'admin') {
      throw new ForbiddenError('You must be admin to perform this operation');
    }

    if(userIdToRevoke === user.id) {
      throw new ForbiddenError('You cannot remove yourself from an account');
    }

    var userToRevoke = await db.t_user.findOne({
      id: userIdToRevoke,
      account_id: userWithAccount.account_id,
      is_deleted: false
    }, {fields: ['id', 'role', 'account_id']});

    if(userIdToRevoke === null) {
      throw new NotFoundError();
    }

    // deleting user
    var deletedUser = await db.t_user.update(userToRevoke.id, {
      is_deleted: true
    });

    // disonnect all connected devices
    await db.t_device.update({
      user_id: userIdToRevoke,
      revoked: false
    }, {
      revoked: true
    });

    return deletedUser;
  } 

  async function getInvoices(user) {
      
    // get the account_id of the currently connected user
    var userWithAccount = await db.t_user.findOne({
      id: user.id
    }, {fields: ['id', 'email', 'account_id']});

    // get the invoices
    var invoices = await db.t_account_payment_activity.find({
      account_id: userWithAccount.account_id,
      stripe_event: 'invoice.payment_succeeded',
      closed: true
    }, {fields: ['id', 'hosted_invoice_url', 'invoice_pdf', 'amount_paid', 'created_at']});

    return invoices;
  }

  return {
    getUsers,
    updateCard,
    revokeUser,
    subscribeMonthlyPlan,
    cancelMonthlySubscription,
    subscribeAgainToMonthlySubscription,
    subscribeMonthlyPlanWithoutAccount,
    stripeEvent,
    getCard,
    getInvoices
  };
};