
import dotenv from 'dotenv'
dotenv.config()

import cron from 'node-cron';

import { Client, Events, GatewayIntentBits, ActivityType } from 'discord.js';
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

//  console.log('Task runs at 5:30 AM Mountain Time');
cron.schedule('30 5 * * *', () => {
  streamingMessages = {};
}, { timezone: 'America/Denver'});

cron.schedule('0 9 * * 1', async () => {
  await dayOfWeek("Monday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 2', async () => {
  await dayOfWeek("Tuesday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 5', async () => {
  await dayOfWeek("Friday");
}, { timezone: 'America/Denver' });

cron.schedule('0 9 * * 6', async () => {
  await dayOfWeek("Saturday");
}, { timezone: 'America/Denver' });

async function dayOfWeek(weekday) {
  try {
    const result = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_MESSAGES_COLLECTION_ID,
      [
        Query.startsWith('folder', weekday.charAt(0).toLowerCase()),
        Query.limit(25),
      ]
    );

    if (result.total > 0) {
      const randomIndex = Math.floor(Math.random() * result.documents.length);
      const doc = result.documents[randomIndex];
      const folderName = doc.folder.charAt(0).toUpperCase() + doc.folder.slice(1);

      const channel = await client.channels.fetch(process.env.DISCORD_GUILD_ID);

      if (channel && channel.isTextBased()) {
        await channel.send(`It's ${folderName} ${weekday}`);
        await evaFunction(channel, doc.folder); 
      }
    }
  } catch (error) {
    console.error(`${weekday} message error:`, error);
  }
}


async function handleInteraction(interaction) {
    try {
        if (!interaction.isCommand()) return;

        const { commandName, user, options } = interaction;

        // Defer reply only if command is 'create' (because it might take time)
        if (commandName === 'create') {
            await interaction.deferReply({ ephemeral: true });

            // Check if user is registered
            const selfRegistered = await db.listDocuments(
                process.env.APPWRITE_DATABASE_ID,
                process.env.APPWRITE_USERS_COLLECTION_ID,
                [Query.equal('discordUsername', [user.username])]
            );

            if (selfRegistered.documents.length === 0) {
                const message = `Your account isn't registered. Click [here](https://discord.com/oauth2/authorize?response_type=code&client_id=1261843540665958531&state=%7B%22success%22%3A%22https%3A%5C%2F%5C%2Fevabot.pages.dev%5C%2F%22%2C%22failure%22%3A%22https%3A%5C%2F%5C%2Fevabot.pages.dev%5C%2F%22%2C%22token%22%3Afalse%7D&scope=identify+email&redirect_uri=https%3A%2F%2Ffra.cloud.appwrite.io%2Fv1%2Faccount%2Fsessions%2Foauth2%2Fcallback%2Fdiscord%2F669318be00330e837d7f) to get started`;
                return await interaction.editReply({ content: message });
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

            const successMsg = `Added '${options.getString("message").trim()}' to [${options.getString("folder").trim().toLowerCase()}] successfully`;
            return await interaction.editReply({ content: successMsg });
        } 
        else if (commandName === "echo") {
            // For echo, just send a fresh message as the bot
            const echoMessage = options.getString("message");
            return await interaction.reply({ content: echoMessage, ephemeral: false });
            // or use followUp if you already deferred
        }

    } catch (error) {
        console.error(error);
        // If interaction was deferred, edit reply; else reply normally
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: "I can't show that!" });
        } else {
            await interaction.reply({ content: "I can't show that!", ephemeral: true });
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
                Query.orderAsc('$updatedAt'),
                Query.limit(1)
            ]
        );

        if(getTotal.total === 0)
        {
            return 0;
        }
        let defaultLimit = 2;
        if(getTotal.total <= 2)
        {
            defaultLimit = 1;
        }

        const result = await db.listDocuments
        (
            process.env.APPWRITE_DATABASE_ID, 
            process.env.APPWRITE_MESSAGES_COLLECTION_ID, 
            [
                Query.equal("folder", [`${folder}`]),
                Query.orderAsc('$updatedAt'),
                Query.limit(defaultLimit)
            ]
        );

        //Can't happen V
        if(result.total === 0)
        {
            return 0;
        }

        const documents = result.documents;

        const randomIndex = Math.floor(Math.random() * documents.length);
        const randomDocument = documents[randomIndex];
        const randomDocumentMessage = randomDocument.message;

        await db.updateDocument(process.env.APPWRITE_DATABASE_ID, process.env.APPWRITE_MESSAGES_COLLECTION_ID, randomDocument.$id, 
            {
                folder: randomDocument.folder,
                message: randomDocument.message,
                seen: !randomDocument.seen,
                createdBy: randomDocument.createdBy || 'simok123'
            },
            randomDocument.$permissions
        )

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



async function reset()
{    
    
    client.on(Events.MessageCreate, async message => { 
        if (message.author.bot) return;

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
        else if(message.content.toLowerCase().includes('eva'))
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

app.listen(port, () => {
    console.log(`App is listening on port ${port}`);
});
