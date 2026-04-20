// Hand-written demo transcripts. Played back by `mockPlayer.ts` at the normal
// chunk cadence so the entire downstream pipeline (suggestions, chat, export)
// exercises without a microphone or Whisper.
//
// Speaker labels are included so the suggestion and chat prompts see who
// said what — useful for "question to ask <name>", "fact-check <name>'s
// claim", etc. Whisper itself does not do speaker diarization; for real
// meetings you'd need a separate provider (Deepgram, AssemblyAI, pyannote).

export interface MockLine {
  speaker: string;
  text: string;
  // Approximate seconds of speech this line represents. We use it to group
  // lines into chunks that match `chunkSeconds` (~30s by default).
  durationSec: number;
}

export interface MockScenario {
  id: string;
  title: string;
  description: string;
  lines: MockLine[];
}

// ---------- Scenario 1: TwinMind founder podcast ----------
// Condensed/cleaned from the "AI Masters: Daniel George & How TwinMind Is
// Inventing The Internet's Memory Layer" podcast transcript. Preserves the
// substantive claims, product details, company names, and numeric facts so
// the suggestion model has real material to fact-check, answer, and drill
// into.

const TWINMIND_PODCAST: MockScenario = {
  id: "podcast",
  title: "TwinMind founder podcast",
  description:
    "Interview with Daniel George, CEO & co-founder of TwinMind — always-on AI, on-device transcription, memory layer, proactive Jarvis-like assistant.",
  lines: [
    { speaker: "Host",   text: "Hey everybody, today we're joined by Daniel George, CEO and co-founder of TwinMind — the first personalized, proactive, always-on AI. Essentially Jarvis from Iron Man. It continuously learns you and gives you perfect memory of your life.", durationSec: 15 },
    { speaker: "Host",   text: "Daniel worked at Google X as an AI research scientist, and at JP Morgan and Wolfram. He has a PhD in AI and astrophysics and more than fifty thousand citations to his work. Welcome.", durationSec: 11 },
    { speaker: "Daniel", text: "Thanks for having me, it's an absolute pleasure.", durationSec: 4 },
    { speaker: "Host",   text: "So tell us — what's the story behind TwinMind?", durationSec: 4 },
    { speaker: "Daniel", text: "Back in 2010 we watched Iron Man, and the vision of Jarvis is what I thought ChatGPT would be — but it's still really far off. Jarvis just knows everything about you: your past, what you're going through, your priorities, what's coming up. ChatGPT is super useful, but it's like using DOS in the 1980s — a terminal you type commands into, and you get something out. That's not the real personal-AI vision I always wanted.", durationSec: 22 },
    { speaker: "Daniel", text: "So we started building TwinMind in early 2024 to be that always-on proactive AI with perfect memory of your life. My co-founders and I all worked together at Google in 2019. We shared this obsession with AI and used to geek out about how the world could be a simulation and we could all be NPCs in some future world with a ChatGPT version 10 running in our heads.", durationSec: 20 },
    { speaker: "Daniel", text: "When ChatGPT came out end of 2022, we started using it and all said the same thing: this isn't what we wanted. People were hacking together versions — transcribing speech with a script, pinging ChatGPT every 20 seconds asking 'give me bullet points so I sound smarter.' It kind of worked like Jarvis but the latency was 20 seconds and there was no memory. So we decided to just build it ourselves.", durationSec: 24 },
    { speaker: "Host",   text: "How did you actually make it possible? ChatGPT, Claude, Perplexity — none of them are actually on all the time.", durationSec: 8 },
    { speaker: "Daniel", text: "We have an iPhone app with super low-latency, high-accuracy transcription running continuously on-device using Apple Silicon. If you want even higher accuracy and it's not a sensitive conversation, there's a cloud mode that handles a hundred languages. Less than a second latency. Every word you say is captured even when the phone is in your pocket or your bag, in a crowded mall or a coffee shop or a bar.", durationSec: 22 },
    { speaker: "Daniel", text: "Every time you look at your phone, we run an AI model that has the transcript of what you just said plus your past memories, and it tries to predict what you want to know in that moment. None of the LLMs out there — ChatGPT, Claude — know when to show you something and what to show you given the context. You have to ask explicitly each time.", durationSec: 19 },
    { speaker: "Host",   text: "So this is a new architecture?", durationSec: 3 },
    { speaker: "Daniel", text: "Yes. We fine-tuned foundation models on a bunch of our own training data for this specific task. And we added a memory layer. Think of LLMs as the intelligence layer — like the CPU of a computer. In the 80s companies raced to build the best chips; today everyone's racing to build the best LLM. But to create something like a human brain you need intelligence plus a memory layer that has your whole life, plus a context-capturing layer — eyes and ears to capture what's happening all day, plus intent prediction.", durationSec: 28 },
    { speaker: "Daniel", text: "Intent prediction is when a human knows the right time to interrupt someone with critical information. If you're talking about something and you're looking for Nvidia's stock price and I don't know it, a real Jarvis would just jump in and say 'hey, this is the number.' LLMs aren't trained to jump in — they're reactive, not proactive. You have to write the whole thing, click send, and wait.", durationSec: 20 },
    { speaker: "Host",   text: "So there's a proactive layer, a memory layer, and a context-capturing layer.", durationSec: 5 },
    { speaker: "Daniel", text: "Exactly. And we had to build a lot of optimizations to capture audio all day without killing your battery. We don't show the live transcript because that kills the CPU and GPU. We collect very low-energy audio streams, then every 30 seconds or every minute we suddenly turn on the CPU and GPU for a second, transcribe the whole thing, and turn it off. We can run the app from 9am to 9pm — 12 hours — without killing the battery on the latest iPhones.", durationSec: 26 },
    { speaker: "Host",   text: "I'm using it right now to transcribe this interview, believe it or not. Do you mind if I show the camera? It's just transcribing right now and I'll pull down for the insights. It's instant compared to ChatGPT where you sometimes wait minutes for advanced reasoning.", durationSec: 14 },
    { speaker: "Host",   text: "So what sort of roadmap, what sort of features do you envision on top of what you've built so far?", durationSec: 6 },
    { speaker: "Daniel", text: "Phase one is immediate value — you have a conversation, a meeting, or a lecture and get an instant summary. Students use it for lectures, ask it questions instead of asking the professor, and it tells them the same thing the professor said but more personalized than just answering from a textbook. For work meetings you get action items, can write follow-up emails. Basically a really superpowered AI notetaker.", durationSec: 22 },
    { speaker: "Host",   text: "Actually this is asking me to ask you something right now — it's asking, how does the app handle complex questions about lecture summaries?", durationSec: 9 },
    { speaker: "Daniel", text: "The app has access to your entire transcript and all of the world's knowledge like an LLM, and it can search the web. We have a multi-step reasoning model that decides given your question: should I read all the transcripts, should I search the web, or should I use my existing memory and just answer? It can do multiple things — read the transcript, then search the web, then come up with its own final answer.", durationSec: 22 },
    { speaker: "Daniel", text: "Phase two is long-term benefits. Once you've used it for a week, a month — you can ask 'recap my memorable moments from this month' or 'give me feedback on how I can improve as a CEO based on all my conversations with my team and investors.' It can list action items you missed, check things off automatically. I got TwinMind to write an investment memo and pitch deck about itself, based on all the conversations I had with the team and the investors. The investors loved it.", durationSec: 28 },
    { speaker: "Host",   text: "Fascinating. In terms of integrations — what resources can it currently ingest, and is there a vision for additional memory uploading?", durationSec: 8 },
    { speaker: "Daniel", text: "We integrate with Google Calendar. We have a Chrome extension that syncs with the app — install it, add any tabs: Gmail, Slack, Notion, a Google Doc — and it grabs context from that and adds to memory. You can say 'based on what we discussed in this meeting and this pitch deck someone shared, write an investment memo.' Or 'what are my most important emails today and which ones should I actually reply to?' It can prioritize better than any AI because it has long-term memory of what matters to you.", durationSec: 30 },
    { speaker: "Host",   text: "Will there ever be an option to just give it full access to everything?", durationSec: 5 },
    { speaker: "Daniel", text: "Our first version did that. People didn't want it for privacy reasons, because it just adds all your tabs. So we made it manual — you add the tabs you're interested in, so you have full control. Also, if you add too much context the models might get overwhelmed. As LLMs get better, they'll handle hundreds of tabs; right now we can handle around 10.", durationSec: 18 },
    { speaker: "Daniel", text: "When Aquaria, one of my co-founders, was hunting for our house — we wanted a cottage in the back where I could live with my wife and a main house where the co-founders live. Zillow has no filter for cottage. I opened 50 different houses and asked the Chrome extension to read all of them and tell me which ones had an ADU or a cottage. It did it instantly. Would have taken me hours to read all those descriptions.", durationSec: 25 },
    { speaker: "Host",   text: "So it's a workflow change that has to be adopted.", durationSec: 4 },
    { speaker: "Daniel", text: "We use it reviewing machine-learning research papers — 10 of them open at once, ask to compare and find which one we should use, or the advantages and disadvantages of each model. It does a great job reading 10 or 20 things at once. Otherwise it's painful to download them one by one and attach them in ChatGPT.", durationSec: 18 },
    { speaker: "Daniel", text: "We also have an extension of deep research we call deep memory search. It researches the entire web AND searches your entire past, so it knows everything you've ever said before. By combining both, it does a much better job than letting deep research go without knowing anything about you.", durationSec: 18 },
    { speaker: "Host",   text: "Who has it proven best for so far?", durationSec: 4 },
    { speaker: "Daniel", text: "Half our users are students — transcribe lecture notes, create assignments, study guides, flash cards. The other half are professionals: tech workers, knowledge workers, people who go to a lot of conferences. They use the app in their pocket, and at the end of the day ask 'who did I meet, can you find all the LinkedIn profiles and give me short memorable things each person said.' Investors use it actively — they meet 10 founders a day and don't remember who said what; they can go home and ask this to write an investment memo for each company.", durationSec: 32 },
    { speaker: "Daniel", text: "You can use Otter, Granola, and others to capture virtual meetings like a Zoom call, but there's no real go-to product for in-person meetings. We have a lot of people using this for in-person meetings — a lot of the most important things happen in person.", durationSec: 14 },
    { speaker: "Host",   text: "How have you been using it personally, beyond the tabs and the research papers and the cottage hunt?", durationSec: 6 },
    { speaker: "Daniel", text: "Every day. I have six months of my life captured. I should probably get a Guinness World Record for most words captured by a person — I run it all day, every day. I use it to get action items after every call. As a CEO we have all these meetings and I need to know what tasks need to be done. We're working on a unified action-item list that combines across multiple memories — instead of a Jira or to-do app, this captures it automatically.", durationSec: 26 },
    { speaker: "Daniel", text: "The team version has collaboration features — I go to a meeting, get five action items, tap to assign one to my iOS engineer, and it shows up on his TwinMind. You can share a meeting with anyone on your team. It has built-in virality — people you share with see a banner at the top saying 'download TwinMind' with a beautiful summary below. We had a student capture every lecture for an entire semester, create a study guide, and share it with a class of 100 people — a lot of them started using it.", durationSec: 30 },
    { speaker: "Daniel", text: "I also like finding the memorable moments of my month — the funny thing my wife said two weeks ago that would otherwise be completely lost. It's not just productivity; on the other side it's actually changing the quality of life. I collected five months of memories — it's like Google Photos, once you've got two years of photos you're paying the ten dollars a month because you want them.", durationSec: 22 },
    { speaker: "Host",   text: "On future integrations — photos, maybe Apple Photos, Google Photos, personalized graphs?", durationSec: 6 },
    { speaker: "Daniel", text: "The next feature, almost done, lets you add photos, files, your own notes during a meeting, photos of a whiteboard or a PowerPoint at a conference. We connect with Apple Photos, so you pair everything together into a nice timeline of your life. With the Chrome extension you can insert text directly — look at a Notion page, say 'update this based on our recent call,' it writes the update and you click insert. Same for email: click reply, say 'write the follow-up email based on the thread and the conversation I just had.'", durationSec: 30 },
    { speaker: "Host",   text: "On a more technical note — is there a plan to release an API for integrating with platforms?", durationSec: 6 },
    { speaker: "Daniel", text: "Eventually a memory API. You own your memories; they stay on your device or your own private cloud. If you open Netflix and want your own personalized feed, right now Netflix's recommendation is terrible — my wife and I spend 10 minutes picking something. If Netflix could pull from your memory layer to query what you like, your TwinMind is like a second brain that's already gone through Netflix and figured out what you'd like. If you open up that API, everyone benefits — YouTube, the Google news feed — they'd all get better.", durationSec: 32 },
    { speaker: "Host",   text: "To play devil's advocate — what happens when the AI is constantly learning you and adapting everything? What becomes of your perception of reality?", durationSec: 9 },
    { speaker: "Daniel", text: "If you let OpenAI or Google determine the best AI, you have one AI everybody's using and everybody's learning from, and whatever values that AI has becomes the propaganda everybody else receives. We want each individual's AI to reflect the values and culture they were born in, learned from their parents. Someone in India who grew up traditionally versus someone in Japan or the US — we all have different values. Democratize AI. Don't have one universal ChatGPT or Gemini dictating what's right.", durationSec: 30 },
    { speaker: "Daniel", text: "Right now we're already living in a world where our perceptions are customized and fine-tuned by an algorithm we don't control — you can see it in the news, the rising tensions. Give each person their own AI they can train any way they want, like they train their child. We don't want a 1984 Big Brother AI.", durationSec: 18 },
    { speaker: "Host",   text: "Last question — if people want to start with TwinMind, how should they go about it?", durationSec: 5 },
    { speaker: "Daniel", text: "Go to twinmind.com. iPhone users can download on the App Store. Anybody can install the Chrome extension from the Chrome Web Store — works on Windows, Mac, any device. We just launched this week, so we'd love feedback to keep improving the product. Join us on this journey to create the best TwinMind for every human.", durationSec: 18 },
    { speaker: "Host",   text: "Daniel, thank you for taking the time. It's been an honor. Wishing you the best of luck.", durationSec: 6 },
    { speaker: "Daniel", text: "Thank you, it was great to be on the podcast.", durationSec: 3 },
  ],
};

// ---------- Scenario 2: Product kickoff ----------

const PRODUCT_KICKOFF: MockScenario = {
  id: "product",
  title: "Product kickoff",
  description:
    "PM + engineer scoping a new feature with fuzzy requirements. Good for question + clarify suggestions.",
  lines: [
    { speaker: "Dana (PM)",  text: "Alright, let's kick off the new onboarding flow. The goal is to get time-to-first-value under two minutes.", durationSec: 7 },
    { speaker: "Ravi (Eng)", text: "Great. Before we dive in — what does 'first value' actually mean for this product? Is it first message sent, or first team invited?", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "Good question. Leadership is saying first message sent, but the retention data suggests it's actually first team invited.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "Okay, and what's the current baseline? I don't want to build a whole new flow without knowing where we are today.", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "The current median is about four and a half minutes, p90 is closer to eleven minutes. Most of the drop-off is at the team-creation step.", durationSec: 11 },
    { speaker: "Ravi (Eng)", text: "That's the one with the long form, right? Name, industry, size, use case — it's a lot to ask upfront.", durationSec: 8 },
    { speaker: "Dana (PM)",  text: "Yeah, and we A/B tested removing industry last quarter, the conversion lift was small, like two percent.", durationSec: 9 },
    { speaker: "Ravi (Eng)", text: "What about making the whole team creation optional? Let the user send a message first, then prompt them to invite teammates later.", durationSec: 10 },
    { speaker: "Dana (PM)",  text: "I like that. Though product said they want team creation early so we can surface the billing plans. Revenue concern.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "Is there a number on that? How many single-user accounts ever convert to team plans later?", durationSec: 8 },
    { speaker: "Dana (PM)",  text: "I'd have to check. I'll ask data after this. We also haven't talked about the invite email — it's still the old template from 2023.", durationSec: 10 },
    { speaker: "Ravi (Eng)", text: "What platforms are we targeting first? Web only, or mobile at the same time?", durationSec: 7 },
    { speaker: "Dana (PM)",  text: "Web first. Mobile team is heads-down on the notifications overhaul until end of quarter.", durationSec: 7 },
    { speaker: "Ravi (Eng)", text: "Last thing — how are we measuring success? Just the two-minute number, or are we also tracking thirty-day retention?", durationSec: 9 },
    { speaker: "Dana (PM)",  text: "Both. Primary metric is time-to-first-value, guardrail is thirty-day retention. If we tank retention we roll it back.", durationSec: 10 },
  ],
};

// ---------- Scenario 3: 1:1 / career ----------

const ONE_ON_ONE: MockScenario = {
  id: "oneonone",
  title: "1:1 career conversation",
  description:
    "Manager + report discussing growth and feedback. Good for talking point + question suggestions.",
  lines: [
    { speaker: "Manager", text: "Thanks for making time. I wanted to use this one to talk about where you want to be a year from now.", durationSec: 7 },
    { speaker: "Report",  text: "Yeah, I've been thinking about that. I think I want to move from senior to staff, but I'm not sure what the gap actually is.", durationSec: 10 },
    { speaker: "Manager", text: "That's a good frame. Honestly the biggest gap I see is scope — you're delivering great on your project, but staff engineers pull in multiple teams' worth of problems.", durationSec: 12 },
    { speaker: "Report",  text: "Can you give me a concrete example of what that would look like on my team?", durationSec: 7 },
    { speaker: "Manager", text: "Sure. The search rewrite is a good candidate. Right now each team is reinventing relevance tuning. A staff person would own the shared abstraction across all three.", durationSec: 12 },
    { speaker: "Report",  text: "Okay, that's useful. How do I start picking that up without stepping on anyone's toes?", durationSec: 8 },
    { speaker: "Manager", text: "Start by writing the problem statement. Not a solution, just the shared pain. Circulate it, get buy-in. That's the real skill.", durationSec: 10 },
    { speaker: "Report",  text: "Got it. What else? On the technical side, anything I should be leveling up?", durationSec: 8 },
    { speaker: "Manager", text: "Honestly less than you'd think. System design is fine. Where you sometimes lose people is in the explanation — too much detail, too fast. Staff is about crisp communication.", durationSec: 13 },
    { speaker: "Report",  text: "That's fair feedback. I've heard it before. Any tactical suggestions for working on it?", durationSec: 8 },
    { speaker: "Manager", text: "Try writing the one-paragraph summary first, every time. Before the doc, before the meeting. If you can't fit it in a paragraph you haven't thought about it enough.", durationSec: 12 },
    { speaker: "Report",  text: "I'll try that. Last thing — is there a formal promotion process I should be aware of, or is it on your timing?", durationSec: 9 },
    { speaker: "Manager", text: "There's a calibration cycle every six months. Next one is in March. If we're aligned by then I'll put you up.", durationSec: 10 },
    { speaker: "Report",  text: "That's a great target. What would you want to see from me between now and then?", durationSec: 7 },
    { speaker: "Manager", text: "The search rewrite proposal, circulated and signed off. That alone would be a huge signal.", durationSec: 8 },
  ],
};

export const MOCK_SCENARIOS: MockScenario[] = [
  TWINMIND_PODCAST,
  PRODUCT_KICKOFF,
  ONE_ON_ONE,
];

export function getScenario(id: string | null | undefined): MockScenario {
  return MOCK_SCENARIOS.find((s) => s.id === id) ?? MOCK_SCENARIOS[0];
}
