import dotenv from 'dotenv'
dotenv.config()

import { GoogleGenAI, Modality } from "@google/genai";

import cron from 'node-cron';

import  { Client, Events, GatewayIntentBits, ActivityType, AttachmentBuilder } from 'discord.js';
import { Client as AppwriteClient, Users, Databases, Query, Permission, Role, ID } from 'node-appwrite';
import { getRandomImage } from './imageUtils.js';

import express from 'express';

const app = express()
const port = process.env.PORT || 3000

let client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildPresences
    ],
  });

const db = new Databases(new AppwriteClient().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));

let streamingMessages = {};
let allMessages = [];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

//  console.log('Task runs at 5:30 AM Mountain Time');
cron.schedule('30 5 * * *', () => {
  streamingMessages = {};
  allMessages = [];
}, { timezone: 'America/Denver'});

cron.schedule('0 9 * * 0', async () => {
  await dayOfWeek("Sunday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 1', async () => {
  await dayOfWeek("Monday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 2', async () => {
  await dayOfWeek("Tuesday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 3', async () => {
  await dayOfWeek("Wednesday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 4', async () => {
  await dayOfWeek("Thursday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 5', async () => {
  await dayOfWeek("Friday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 6', async () => {
  await dayOfWeek("Saturday");
}, { timezone: 'America/Denver' });

async function dayOfWeek(weekday) {
  try {
    let queries = [];

    if(weekday !== "Wednesday" && weekday !== "Thursday")
    {
      queries.push(Query.startsWith('folder', weekday.charAt(0).toLowerCase()));
    }
    
    queries.push(Query.orderAsc('$updatedAt'));
    queries.push(Query.limit(2));

    const result = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FOLDERS_COLLECTION_ID,
      queries
    );

    if (result.total > 0) {

      let documents = result.documents;

      const randomIndex = Math.floor(Math.random() * documents.length);
      const randomDoc = documents[randomIndex];
      const folderName = randomDoc.folder
        .trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      // Step 4: Fetch the Discord channel and send the message
      const channel = await client.channels.fetch(process.env.DISCORD_GUILD_ID);

      if (channel && channel.isTextBased()) {
        await channel.send(`It's ${folderName} ${weekday}`);
        await evaFunction(channel, randomDoc.folder); 
      }
    }
  } catch (error) {
    console.error(`${weekday} message error:`, error);
  }
}


async function handleInteraction(interaction) {
    try {
        if (!interaction.isCommand()) return;

        const { commandName, user, options, channel } = interaction;

        // Defer reply only if command is 'create' (because it might take time)
        if (commandName === 'create') {
            await interaction.deferReply({ flags: 64 }); // ephemeral defer

            // Check if user is registered
            const selfRegistered = await db.listDocuments(
                process.env.APPWRITE_DATABASE_ID,
                process.env.APPWRITE_USERS_COLLECTION_ID,
                [Query.equal('discordUsername', [user.username])]
            );

            if (selfRegistered.documents.length === 0) {
                const message = `Your account isn't registered. Click [here](https://discord.com/oauth2/authorize?response_type=code&client_id=1261843540665958531&state=%7B%22success%22%3A%22https%3A%5C%2F%5C%2Fevabot.pages.dev%5C%2F%22%2C%22failure%22%3A%22https%3A%5C%2F%5C%2Fevabot.pages.dev%5C%2F%22%2C%22token%22%3Afalse%7D&scope=identify+email&redirect_uri=https%3A%2F%2Ffra.cloud.appwrite.io%2Fv1%2Faccount%2Fsessions%2Foauth2%2Fcallback%2Fdiscord%2F669318be00330e837d7f) to get started`;
                return await interaction.editReply({ content: message, flags: 64 }); // ephemeral edit reply
            }

            // Create document
            await db.createDocument(
                process.env.APPWRITE_DATABASE_ID,
                process.env.APPWRITE_MESSAGES_COLLECTION_ID,
                ID.unique(),
                {
                    folder: options.getString("folder").trim().toLowerCase(),
                    message: options.getString("message").trim(),
                    seen: false,
                    createdBy: user.username
                },
                [Permission.write(Role.user(selfRegistered.documents[0].$id))]
            );

            await updateFolder(options.getString("folder").trim().toLowerCase());

            const successMsg = `Added '${options.getString("message").trim()}' to [${options.getString("folder").trim().toLowerCase()}] successfully`;
            return await interaction.editReply({ content: successMsg, flags: 64 }); // ephemeral edit reply
        } 
        else if (commandName === "echo") {

            const echoMessage = options.getString("message");

            // Defer the reply so Discord doesn't complain, ephemeral
            await interaction.deferReply({ flags: 64 });

            // Send the actual message to the channel (not ephemeral)
            await channel.send(echoMessage);

            // Delete the deferred ephemeral reply so user sees nothing
            await interaction.deleteReply();
        }

    } catch (error) {
        console.error(error);
        // If interaction was deferred, edit reply; else reply normally
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: "I can't show that!", flags: 64 });
        } else {
            await interaction.reply({ content: "I can't show that!", flags: 64 });
        }
    }
}

async function evaFunction(channel, folder) {
    let response = "";
    
    try {

        const getTotal = await db.listDocuments
        (
            process.env.APPWRITE_DATABASE_ID, 
            process.env.APPWRITE_MESSAGES_COLLECTION_ID, 
            [
                Query.equal("folder", [`${folder}`]),
                Query.orderDesc('$updatedAt'),
            ]
        );

        if(getTotal.total === 0)
        {
            return 0;
        }

        const result = await db.listDocuments
        (
            process.env.APPWRITE_DATABASE_ID, 
            process.env.APPWRITE_MESSAGES_COLLECTION_ID, 
            [
                Query.equal("folder", [`${folder}`]),
                Query.orderAsc('$updatedAt'),
                Query.limit(2)
            ]
        );

        let documents = result.documents;

        const randomIndex = Math.floor(Math.random() * documents.length);
        let randomDocument = documents[randomIndex];
        let randomDocumentMessage = randomDocument.message;

        let recentlyAddedDocuments = [];
        for(let i = 0; i < getTotal.documents.length; i++)
        {
            if(getTotal.documents[i].$updatedAt === getTotal.documents[i].$createdAt)
            {
                recentlyAddedDocuments.push(getTotal.documents[i]);
            }
        }
        
        if(recentlyAddedDocuments.length > 0)
        {
            const randomRecentlyIndex = Math.floor(Math.random() * recentlyAddedDocuments.length);
            const randomRecentlyDocument = recentlyAddedDocuments[randomRecentlyIndex];
            const randomRecentlyDocumentMessage = randomRecentlyDocument.message;

            if (Math.random() < 0.5) {
                randomDocument = randomRecentlyDocument;
                randomDocumentMessage = randomRecentlyDocumentMessage;
            }
        }

        await db.updateDocument(process.env.APPWRITE_DATABASE_ID, process.env.APPWRITE_MESSAGES_COLLECTION_ID, randomDocument.$id, 
            {
                folder: randomDocument.folder,
                message: randomDocument.message,
                seen: !randomDocument.seen,
                createdBy: randomDocument.createdBy || 'simok123'
            },
            randomDocument.$permissions
        );

        await updateFolder(folder);

        response = `${randomDocumentMessage}`;
        await channel.send(`${response}`);
        return 1;
    }
    catch(error) 
    {
        console.error(error);
        return 0;
    }
}

async function updateFolder(folderToUpdate)
{
    const getFoldersDoc = await db.listDocuments
    (
        process.env.APPWRITE_DATABASE_ID, 
        process.env.APPWRITE_FOLDERS_COLLECTION_ID, 
        [
            Query.equal("folder", [`${folderToUpdate}`]),
            Query.limit(1)
        ]
    );

    if(getFoldersDoc.total > 0)
    {
      await db.updateDocument(process.env.APPWRITE_DATABASE_ID, process.env.APPWRITE_FOLDERS_COLLECTION_ID, getFoldersDoc.documents[0].$id,
        {
          folder: getFoldersDoc.documents[0].folder,
          seen: !getFoldersDoc.documents[0].seen,
        });
    }
    else
    {
      await db.createDocument(process.env.APPWRITE_DATABASE_ID, process.env.APPWRITE_FOLDERS_COLLECTION_ID, ID.unique(),
        {
          folder: folderToUpdate,
          seen: false
        }
      );
    }
}

async function showMe(split, channel) {
  if (split.length > 1) {
    let searchTerm = split[1].trim();

    if (searchTerm.length > 0) {
      const result = await evaFunction(channel, searchTerm);

      if (result === 0) {
        try {
          let sfw = true;
            
          if (searchTerm.toLowerCase().startsWith("nsfw ")) {
            sfw = false;
          }

          const response = await getRandomImage(searchTerm, sfw);
          await channel.send(`${response}`);
        } catch (error) {
          await channel.send("I can't show that!");
        }
      }
    }
  }
}

async function askEva(prompt, channel) {

    if(!prompt)
    {
        return;
    }
    try
    {
        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `Respond to the following in a paragraph: ${prompt}`,
          config: {
              maxOutputTokens: 500,
              temperature: 0.7, // More creative output
              topP: 0.95,
              topK: 40,
          },
        });
        await channel.send(`${response.text}`);
    }
    catch(err)
    {
      await channel.send("I can't show that!");
    }
    //console.log(response.text);
}

async function evaImagine(prompt, channel) {
    const contents = prompt;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-preview-image-generation",
            contents: contents,
            config: {
                responseModalities: [Modality.TEXT, Modality.IMAGE],
            },
        });

        // Loop through the response to find image data
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const imageData = part.inlineData.data;
                const buffer = Buffer.from(imageData, "base64");

                // Create a MessageAttachment from the buffer
                const attachment = new AttachmentBuilder(buffer, { name: ID.unique() + ".png", contentType: 'image/png'});

                // Send the image attachment to the channel
                await channel.send({ files: [attachment] });
            }
        }
    } catch (err) {
      console.log(err);
        await channel.send("I can't show that!");
    }
}

async function reset()
{    
    
    client.on(Events.MessageCreate, async message => { 
        if (message.author.bot) return;

        allMessages.push(`${message.author.username}: ${message.content}`);

        if (message.content.toLowerCase().includes('show me an ') || message.content.toLowerCase().includes('show me the ')) 
        {
            const split = message.content.toLowerCase().split(/show me an |show me the /);
            showMe(split, message.channel);
        }
        else if(message.content.toLowerCase().includes('show me a '))
        {
            const split = message.content.toLowerCase().split(/show me a /);
            showMe(split, message.channel);
        }
        else if (message.content.toLowerCase().includes('show me ')) 
        {
            const split = message.content.toLowerCase().split(/show me /);
            showMe(split, message.channel);
        }
        else if (message.content.toLowerCase().startsWith("evabot, imagine")) 
        {
          const split = message.content.toLowerCase().split("evabot, imagine");
          let searchTerm = split[1]?.trim() || "";

          const attachments = message.attachments;

          // If there are image attachments, convert them to base64 and include them
          if (attachments.size > 0) {
              const firstAttachment = attachments.first();
              if (firstAttachment && firstAttachment.contentType?.startsWith('image/')) {
                      try {
                          const response = await fetch(firstAttachment.url);
                          const buffer = await response.arrayBuffer();
                          const base64Image = Buffer.from(buffer).toString('base64');
    
                          const geminiResponse = await ai.models.generateContent({
                              model: "gemini-2.0-flash-preview-image-generation",
                              contents: [
                                  {
                                      role: "user",
                                      parts: [
                                          { text: searchTerm || "Imagine this..." },
                                          {
                                              inlineData: {
                                                  mimeType: firstAttachment.contentType,
                                                  data: base64Image
                                              }
                                          }
                                      ]
                                  }
                              ],
                              config: {
                                  responseModalities: [Modality.TEXT, Modality.IMAGE],
                              },
                          });
    
                          for (const part of geminiResponse.candidates[0].content.parts) {
                              if (part.inlineData) {
                                  const imageData = part.inlineData.data;
                                  const buffer = Buffer.from(imageData, "base64");
    
                                  const attachment = new AttachmentBuilder(buffer, {
                                      name: ID.unique() + ".png",
                                      contentType: 'image/png'
                                  });
    
                                  await message.channel.send({ files: [attachment] });
                              }
                          }
                      } catch (error) {
                          console.error("Error processing image attachment:", error);
                          await message.channel.send("Sorry, I couldn't process the image.");
                      }
                  } else {
                    if (searchTerm.length > 0) 
                    {
                      const evaResponse = await evaImagine(searchTerm, message.channel);
                    }
                    else
                    {
                      const evaMessage = await evaFunction(message.channel, "eva");
                    }
                  }
              } else if (searchTerm.length > 0) {
                  await evaImagine(searchTerm, message.channel);
              } else {
                  await evaFunction(message.channel, "eva");
              }
          }
        else if(message.content.toLowerCase().startsWith("evabot,"))
        {
            const split = message.content.toLowerCase().split("evabot,");
            if (split.length > 1) 
            {
              let searchTerm = split[1].trim();

              if (searchTerm.length > 0) 
              {
                const evaResponse = await askEva(searchTerm, message.channel);
              }
              else
              {
                const evaMessage = await evaFunction(message.channel, "eva");
              }
            }
            else
            {
              const evaMessage = await evaFunction(message.channel, "eva");
            }
        }
        else if(message.content.toLowerCase().includes("eva"))
        {
            const evaMessage = await evaFunction(message.channel, "eva");
        }
    });
        
    client.on(Events.InteractionCreate, async interaction => {
        if(!interaction.isCommand()) 
        {
            return;
        }
    
        await handleInteraction(interaction);
    });
    
    client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
        try {
            const user = newPresence.user;
            const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        
            if (!newPresence.guild || newPresence.guild.id !== guild.id) return;
            if (user.bot) return;

            const member = await guild.members.fetch(user.id);
            const channel = await guild.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        
            if (!channel || !channel.isTextBased()) return;
        
            // Use optional chaining for newPresence and activities
            const newActivity = newPresence?.activities?.find(
                (a) => a.type === ActivityType.Streaming
            );
        
            // Check if oldPresence is null before accessing activities
            const oldActivity = oldPresence?.activities?.find(
                (a) => a.type === ActivityType.Streaming
            );
        
            const userId = user.id;
        
            // Check if newActivity exists
            if (newActivity) {
                const activityState = newActivity.state ? ` ${newActivity.state}` : '';
                const activityDetails = newActivity.details ? ` ${newActivity.details}` : '';
                const activityName = newActivity.name ? ` on ${newActivity.name}` : '';
                const activityUrl = newActivity.url ? ` ${newActivity.url}` : '';

                const messageToSend = `${member.displayName} is streaming${activityState}${activityDetails}${activityName}${activityUrl}`;

                if(streamingMessages[userId] !== messageToSend)
                {
                    streamingMessages[userId] = messageToSend;
                    await channel.send(messageToSend);
                }
            } 
        } 
        catch (error) 
        {
            console.error(error);
        }
    });

    
    await client.login(process.env.DISCORD_TOKEN);    
}

await reset();


app.get('/', (req, res) => {
    res.json(streamingMessages);
});

app.get('/messages', (req, res) => {
    res.json(allMessages);
});

app.listen(port, () => {
    console.log(`App is listening on port ${port}`);
});
