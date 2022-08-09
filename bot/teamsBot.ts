// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  TeamsActivityHandler,
  CardFactory,
  TurnContext,
  ActivityTypes,
  Attachment,
  Activity,
  MessageFactory,
  ConversationResourceResponse,
  ConversationParameters,
  ConversationReference,
  TeamsChannelData,
  ChannelInfo,
  BotFrameworkAdapter,
} from "botbuilder";
import { QnADTO, QnASearchResultList } from "@azure/cognitiveservices-qnamaker-runtime/esm/models";
import { ResponseCardPayload } from "./models/responseCardPayload";
import { AnswerModel } from "./models/answerModel";
import { QnaServiceProvider } from "./providers/qnaServiceProvider";
import { getResponseCard } from "./cards/responseCard";
import { getAskAnExpertCard } from "./cards/askAnExpertCard";
import { TicketEntity } from "./models/ticketEntity";
import { Constants, TextString } from "./common/constants";
import { getUnrecognizedInputCard } from "./cards/unrecognizedInputCard";
import { AskAnExpertCardPayload } from "./models/askAnExpertCardPayload";
import { TicketsProvider } from "./providers/ticketsProvider";
import { askAnExpertSubmitText } from "./common/adaptiveHelper";
import { getSmeTicketCard } from "./cards/smeTicketCard";
import { ConfigurationDataProvider } from "./providers/configurationProvider";
import { ConfigurationEntityTypes } from "./models/configurationEntityTypes";
import { getUserNotificationCard } from "./cards/userNotificationCard";
import { ChangeTicketStatusPayload } from "./models/changeTicketStatusPayload";
import { TicketState } from "./models/ticketState";
import {
  ResourceResponse,
  ActivityEx,
  ConversationAccount,
  ChannelAccount,
} from "botframework-schema";

export class TeamsBot extends TeamsActivityHandler {
  private readonly conversationTypePersonal: string = "personal";
  private readonly ConversationTypeChannel: string = "channel";
  private readonly ChangeStatus: string = "change status";

  private readonly qnaServiceProvider: QnaServiceProvider;
  private readonly ticketsProvider: TicketsProvider;
  private readonly configurationProvider: ConfigurationDataProvider;

  /**
   *
   * @param {ConfigurationDataProvider} configurationProvider
   * @param {QnaServiceProvider} qnaServiceProvider
   * @param {TicketsProvider} ticketsProvider
   */
  constructor(
    configurationProvider: ConfigurationDataProvider,
    qnaServiceProvider: QnaServiceProvider,
    ticketsProvider: TicketsProvider
  ) {
    super();

    this.qnaServiceProvider = qnaServiceProvider;
    this.ticketsProvider = ticketsProvider;
    this.configurationProvider = configurationProvider;
  }

  /**
   * Invoked when a message activity is received from the user.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  async onMessageActivity(turnContext: TurnContext): Promise<void> {
    try {
      const message = turnContext.activity;
      console.log(
        `from: ${message.from?.id}, conversation: ${message.conversation.id}, replyToId: ${message.replyToId}`
      );
      await this.sendTypingIndicatorAsync(turnContext);

      switch (message.conversation.conversationType.toLowerCase()) {
        case this.conversationTypePersonal:
          await this.onMessageActivityInPersonalChat(message, turnContext);
          break;

        case this.ConversationTypeChannel:
          await this.OnMessageActivityInChannel(message, turnContext);
          break;

        default:
          console.log(
            `Received unexpected conversationType ${message.conversation.conversationType}`
          );
          break;
      }
    } catch (error) {
      await turnContext.sendActivity("");
      console.log(`Error processing message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Invoked when a message activity is received from the user.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  async onConversationUpdateActivity(turnContext: TurnContext): Promise<void> {
    try {
      const activity = turnContext.activity;
      console.log("Received conversationUpdate activity");
      console.log(
        `conversationType: ${activity.conversation.conversationType}, membersAdded: ${activity.membersAdded?.length}, membersRemoved: ${activity.membersRemoved?.length}`
      );

      if (activity?.membersAdded?.length === 0) {
        console.log("Ignoring conversationUpdate that was not a membersAdded event");
        return;
      }

      switch (activity.conversation.conversationType.toLowerCase()) {
        case this.conversationTypePersonal:
          await this.onMembersAddedToPersonalChat(activity.membersAdded, turnContext);
          return;

        default:
          console.log(
            `Ignoring event from conversation type ${activity.conversation.conversationType}`
          );
          return;
      }
    } catch (error) {
      console.log(`Error processing conversationUpdate: ${error.message}`);
    }
  }

  /**
   * Handle 1:1 chat with members who started chat for the first time.
   * @param membersAdded Channel account information needed to route a message.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  private async onMembersAddedToPersonalChat(
    membersAdded: ChannelAccount[],
    turnContext: TurnContext
  ) {
    const activity = turnContext.activity;
    if (membersAdded.some((channelAccount) => channelAccount.id === activity.recipient.id)) {
      console.log(`Bot added to 1:1 chat ${activity.conversation.id}`);
      const card = CardFactory.heroCard("Welcome", null, null, {
        text: TextString.MemberAddedWelcomeMessage,
      });
      await turnContext.sendActivity(MessageFactory.attachment(card));
    }
  }

  /**
   * Handle message activity in channel.
   * @param message A message in a conversation.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  private async OnMessageActivityInChannel(
    message: Activity,
    turnContext: TurnContext
  ): Promise<void> {
    let text = "";

    if (message.replyToId && message.value != null) {
      text = this.ChangeStatus;
    } else {
      text = message.text?.toLowerCase()?.trim() ?? "";
    }

    try {
      switch (text) {
        case this.ChangeStatus:
          console.log("Card submit in channel " + message.value);
          await this.OnAdaptiveCardSubmitInChannelAsync(message, turnContext);
          return;

        default:
          console.log("Unrecognized input in channel");
          await turnContext.sendActivity("todo: Unrecognized input in channel.");
          break;
      }
    } catch (error) {
      console.log(`Error processing message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle message activity in 1:1 chat.
   * @param message A message in a conversation.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  private async onMessageActivityInPersonalChat(
    message: Activity,
    turnContext: TurnContext
  ): Promise<void> {
    if (message.replyToId && message.value != null) {
      console.log("Card submit in 1:1 chat");
      await this.OnAdaptiveCardSubmitInPersonalChatAsync(message, turnContext);
      return;
    }

    const text = message.text?.toLowerCase()?.trim() ?? "";

    switch (text) {
      case Constants.AskAnExpert:
        console.log("Sending user ask an expert card");
        await turnContext.sendActivity(MessageFactory.attachment(getAskAnExpertCard()));
        break;

      default:
        console.log("Sending input to QnAMaker");
        await this.getQuestionAnswerReply(turnContext, message);
    }
  }

  /**
   * Handle adaptive card submit in 1:1 chat.
   * Submits the question or feedback to the SME team.
   * @param message A message in a conversation.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  private async OnAdaptiveCardSubmitInPersonalChatAsync(
    message: Activity,
    turnContext: TurnContext
  ): Promise<void> {
    let smeTeamCard: Attachment; // Notification to SME team
    let userCard: Attachment; // Acknowledgement to the user
    let newTicket: TicketEntity; // New ticket

    switch (message?.text) {
      case Constants.AskAnExpert:
        console.log("Sending user ask an expert card (from answer)");
        const askAnExpertCardPayload: AskAnExpertCardPayload =
          message.value as AskAnExpertCardPayload;
        askAnExpertCardPayload.Description = askAnExpertCardPayload.UserQuestion;
        askAnExpertCardPayload.KnowledgeBaseAnswer = askAnExpertCardPayload.KnowledgeBaseAnswer;
        await turnContext.sendActivity(
          MessageFactory.attachment(getAskAnExpertCard(askAnExpertCardPayload))
        );
        break;

      case Constants.AskAnExpertSubmitText:
        console.log("Received question for expert");
        newTicket = await askAnExpertSubmitText(message, turnContext, this.ticketsProvider);
        if (newTicket) {
          smeTeamCard = getSmeTicketCard(newTicket);
          userCard = getUserNotificationCard(
            newTicket,
            TextString.NotificationCardContent,
            message.localTimestamp
          );
        }

        // Send message to SME team.
        const expertTeamId: string = await this.configurationProvider.getSavedEntityDetailAsync(
          ConfigurationEntityTypes.TeamId
        );

        if (smeTeamCard) {
          const resourceResponse = await this.sendCardToTeamAsync(
            turnContext,
            smeTeamCard,
            expertTeamId
          );

          // If a ticket was created, update the ticket with the conversation info.
          if (newTicket) {
            newTicket.SmeCardActivityId = resourceResponse?.activityId;
            newTicket.SmeThreadConversationId = resourceResponse.id;
            await this.ticketsProvider.upsertTicket(newTicket);
          }
        }

        // Send acknowledgment to the user
        if (userCard) {
          await turnContext.sendActivity(MessageFactory.attachment(userCard));
        }

        break;

      default:
        const payload = message.value as ResponseCardPayload;
        if (payload.IsPrompt) {
          console.log("Sending input to QnAMaker for prompt");
          await this.getQuestionAnswerReply(turnContext, message);
        } else {
          console.log("Unexpected text in submit payload: " + message.text);
        }
    }
  }

  /**
   * Handle adaptive card submit in channel.
   * Updates the ticket status based on the user submission.
   * @param message A message in a conversation.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   */
  private async OnAdaptiveCardSubmitInChannelAsync(
    message: Activity,
    turnContext: TurnContext
  ): Promise<void> {
    const payload = message.value as ChangeTicketStatusPayload;
    console.log(`Received submit: ticketId=${payload.ticketId} action=${payload.action}`);

    // Get the ticket from the data store.
    const ticket = await this.ticketsProvider.getTicket(payload.ticketId);
    if (!ticket) {
      console.log(`Ticket ${payload.ticketId} was not found in the data store`);
      await turnContext.sendActivity(`Ticket ${payload.ticketId} was not found in the data store`);
      return;
    }

    // Notifications to send
    let smeNotification: string = null;
    let userNotification: Partial<Activity> = null;

    ticket.LastModifiedByName = message.from.name;
    ticket.LastModifiedByObjectId = message.from.aadObjectId;

    switch (payload.action) {
      case ChangeTicketStatusPayload.reopenAction:
        // Update ticket
        ticket.Status = TicketState.Open;
        ticket.DateAssigned = null;
        ticket.AssignedToName = null;
        ticket.AssignedToObjectId = null;
        ticket.DateClosed = null;

        // Generate notification
        smeNotification = `This request is now unassigned. Last updated by ${message.from.name}.`;

        userNotification = MessageFactory.attachment(
          getUserNotificationCard(
            ticket,
            TextString.ReopenedTicketUserNotification,
            message.localTimestamp
          )
        );
        userNotification.summary = TextString.ReopenedTicketUserNotification;
        break;

      case ChangeTicketStatusPayload.closeAction:
        // Update ticket
        ticket.Status = TicketState.Closed;
        ticket.DateClosed = new Date();

        // Generate notification
        smeNotification = `This request is now closed. Closed by ${ticket.LastModifiedByName}.`;

        userNotification = MessageFactory.attachment(
          getUserNotificationCard(
            ticket,
            TextString.ClosedTicketUserNotification,
            message.localTimestamp
          )
        );
        userNotification.summary = TextString.ClosedTicketUserNotification;
        break;

      case ChangeTicketStatusPayload.assignToSelfAction:
        // Update ticket
        ticket.Status = TicketState.Open;
        ticket.DateAssigned = new Date();
        ticket.AssignedToName = message.from.name;
        ticket.AssignedToObjectId = message.from.aadObjectId;
        ticket.DateClosed = null;

        // Generate notification
        smeNotification = `This request is now assigned. Assigned to ${ticket.AssignedToName}.`;

        userNotification = MessageFactory.attachment(
          getUserNotificationCard(
            ticket,
            TextString.AssignedTicketUserNotification,
            message.localTimestamp
          )
        );
        userNotification.summary = TextString.AssignedTicketUserNotification;
        break;

      default:
        console.log(`Unknown status command ${payload.action}`);
        return;
    }

    await this.ticketsProvider.upsertTicket(ticket);
    console.log(
      `Ticket ${ticket.TicketId} updated to status (${ticket.Status}, ${ticket.AssignedToObjectId}) in store`
    );

    // Update the card in the SME team.
    const updateCardActivity = ActivityEx.createMessageActivity();
    updateCardActivity.id = ticket.SmeCardActivityId;
    updateCardActivity.conversation = {
      id: ticket.SmeThreadConversationId,
    } as ConversationAccount;
    updateCardActivity.attachments = [getSmeTicketCard(ticket, message.localTimestamp)];

    const updateResponse = (await turnContext.updateActivity(
      updateCardActivity
    )) as ResourceResponse;
    console.log(
      `Card for ticket ${ticket.TicketId} updated to status (${ticket.Status}, ${ticket.AssignedToObjectId}), activityId = ${updateResponse.id}`
    );

    // Post update to user and SME team thread.
    if (smeNotification) {
      const smeResponse = await turnContext.sendActivity(smeNotification);
      console.log(
        `SME team notified of update to ticket ${ticket.TicketId}, activityId = ${smeResponse.id}`
      );
    }

    if (userNotification) {
      userNotification.conversation = {
        id: ticket.RequesterConversationId,
      } as ConversationAccount;
      userNotification.serviceUrl = turnContext.activity.serviceUrl;
      const userResponse = await turnContext.adapter.sendActivities(turnContext, [
        userNotification,
      ]);
      console.log(
        `User notified of update to ticket ${ticket.TicketId}, activityId = ${userResponse[0].id}`
      );
    }
  }

  /**
   * Send the given attachment to the specified team.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   * @param cardToSend The card to send.
   * @param teamId Team id to which the message is being sent.
   * @return conversation resource response from sending the attachment
   */
  private async sendCardToTeamAsync(
    turnContext: TurnContext,
    cardToSend: Attachment,
    teamId: string
  ): Promise<ConversationResourceResponse> {
    const conversationParameter: ConversationParameters = {
      activity: MessageFactory.attachment(cardToSend) as Activity,
      tenantId: turnContext.activity.conversation.tenantId,
      channelData: {
        tenant: { id: turnContext.activity.conversation.tenantId },
        channel: {
          id: teamId,
        } as ChannelInfo,
      } as TeamsChannelData,
    } as ConversationParameters;

    const conversationReference = {
      conversation: {
        id: teamId,
      },
      user: turnContext.activity.from,
      channelId: null, // If we set channel = "msteams", there is an error as preinstalled middleware expects ChannelData to be present.
      serviceUrl: turnContext.activity.serviceUrl,
    } as ConversationReference;

    return new Promise<ConversationResourceResponse>(async (resolve) => {
      await (turnContext.adapter as BotFrameworkAdapter)
        .createConversation(conversationReference, conversationParameter, async (turnContext) => {
          const activity = turnContext.activity;
          let activityId = activity.id;
          if (!activityId) {
            // If bot sdk does not return activity id, try to extract activity id from conversation id
            const messageIdMatches = activity.conversation.id.match(/messageid=(\d+)$/);
            if (messageIdMatches.length === 2) {
              activityId = messageIdMatches[1];
            }
          }
          const conversationResourceResponse: ConversationResourceResponse = {
            id: activity.conversation.id,
            activityId: activityId,
            serviceUrl: activity.serviceUrl,
          };
          resolve(conversationResourceResponse);
        })
        .catch((e) => {
          console.log(
            "Fail to create conversation when sending card to team id :" + teamId + ". Error: " + e
          );
        });
    });
  }

  /**
   * Get the reply to a question asked by end user.
   * @param turnContext Context object containing information cached for a single turn of conversation with a user.
   * @param message A message in a conversation.
   */
  private async getQuestionAnswerReply(turnContext: TurnContext, message: Activity): Promise<void> {
    const text = message.text?.toLowerCase()?.trim() ?? "";

    try {
      let payload: ResponseCardPayload;

      if (message?.replyToId && message?.value) {
        payload = message.value as ResponseCardPayload;
      }

      let previousQuestion: QnADTO;
      if (payload?.PreviousQuestions?.length > 0) {
        previousQuestion = payload.PreviousQuestions[0];
      }

      const queryResult: QnASearchResultList = await this.qnaServiceProvider.gGenerateAnswer(
        text,
        false,
        previousQuestion?.id.toString(),
        previousQuestion?.questions[0]
      );

      if (queryResult?.answers[0].id != -1) {
        const answerData = queryResult.answers[0];
        let answerModel: AnswerModel;
        try {
          answerModel = JSON.parse(answerData.answer) as AnswerModel;
        } catch {
          // do nothing if result is not json format
        }

        await turnContext.sendActivity(
          MessageFactory.attachment(getResponseCard(answerData, text, payload))
        );
      } else {
        console.log("Answer not found. Sending user ask an expert card");
        await turnContext.sendActivity(MessageFactory.attachment(getUnrecognizedInputCard(text)));
      }
    } catch (error) {
      console.log(error);
    }
  }

  private async sendTypingIndicatorAsync(turnContext: TurnContext): Promise<void> {
    try {
      const typingActivity = this.createReply(turnContext.activity);
      typingActivity.type = ActivityTypes.Typing;
      await turnContext.sendActivity(typingActivity);
    } catch (error) {
      console.log(`Failed to send a typing indicator: ${error.message}`);
    }
  }

  private createReply(source: Activity, text?: string, locale?: string): Activity {
    const reply: string = text || "";

    return {
      channelId: source.channelId,
      conversation: source.conversation,
      from: source.recipient,
      label: source.label,
      locale: locale,
      callerId: source.callerId,
      recipient: source.from,
      replyToId: source.id,
      serviceUrl: source.serviceUrl,
      text: reply,
      timestamp: new Date(),
      type: ActivityTypes.Message,
      valueType: source.valueType,
      localTimezone: source.localTimezone,
      listenFor: source.listenFor,
      semanticAction: source.semanticAction,
    };
  }
}
