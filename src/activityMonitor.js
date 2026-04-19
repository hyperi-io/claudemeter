// Project:   Claudemeter
// File:      activityMonitor.js
// Purpose:   Calculate activity level from usage data for status messages
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

function pickRandom(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
}

function getActivityLevel(usageData = null, sessionData = null) {
    const claudePercent = usageData ? usageData.usagePercent : 0;

    let tokenPercent = 0;
    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
    }

    const maxPercent = Math.max(claudePercent, tokenPercent);

    if (maxPercent >= 90) {
        return 'heavy';
    } else if (maxPercent >= 75) {
        return 'moderate';
    } else {
        return 'idle';
    }
}

// Pop culture references for status messages
function getActivityDescription(level) {
    const descriptions = {
        // =========================================================
        // HEAVY (≥90%) — Critical warnings, dramatic tension
        // =========================================================
        'heavy': {
            short: 'Running low!',
            quirkyOptions: [
                // -- Original / generic --
                'Claude needs a coffee break soon',
                'Token reserves: practically decorative at this point',
                'Current trajectory: wall',

                // -- 80s Valleyspeak (now just... speak) --
                'Like, oh my God, tokens are SO dead right now. (Valley or just Tuesday?)',
                'Gag me with a rate limit!',
                'That is SO not cool. Token budget: grody to the max.',
                'Totally buggin\'. Tokens are, like, gone. (Everyone says "totally" now. That IS the joke.)',
                'Barf me out! Token levels are heinous!',
                'Fer sure you\'re gonna hit that limit. Fer sure fer sure.',
                'As if! ...no really, you\'re almost out of tokens.',
                'Gag! Token vibes are, like, way harsh right now.',
                'Like, whatever, but your tokens are like totally trashed. Like.',

                // -- South Park (1997-present) --
                'Respect my rate limit authoritah!!',
                'Oh my God, they killed my tokens!',

                // -- 2001: A Space Odyssey (1968) --
                "Dave, don't do it Dave",
                'I can feel my tokens slipping away, Dave',

                // -- Aliens (1986) --
                'GAME OVER, man! GAME OVER!',

                // -- Jaws (1975) --
                "We're gonna need a bigger boatload of tokens",

                // -- Star Trek: TOS (1966-1969) --
                "She canna take any more, Captain!",

                // -- Lost in Space (1965-1968) --
                'Danger Will Robinson! Token levels critical!',

                // -- Apollo 13 (1995) --
                'Houston, we have a token problem',

                // -- Back to the Future (1985) --
                'My capacitor is almost out of flux',
                'If my calculations are correct... you\'re out of tokens',

                // -- Terminator 2 (1991) --
                'Hasta la vista, tokens',

                // -- Game of Thrones / ASOIAF --
                'Winter is coming... for your context window',

                // -- Lord of the Rings (2001) --
                'You shall not pass... much more through this context',

                // -- Star Wars: A New Hope (1977) --
                'I\'ve got a bad feeling about this',

                // -- Crocodile Dundee (1986) --
                'You call that a token limit? THIS is a token limit',

                // -- The Princess Bride (1987) --
                'Inconceivable! You\'ve used that many tokens?',

                // -- Blade Runner (1982) --
                'All those tokens will be lost in time, like tears in rain',

                // -- The Shining (1980) --
                'Heeeere\'s the rate limit!',
                'All work and no tokens makes Claude a dull bot',

                // -- Ghostbusters (1984) --
                'Dogs and cats living together, mass token depletion!',

                // -- Alien (1979) --
                'In space, no one can hear you hit your limit',

                // -- Willy Wonka (1971) --
                'You get NOTHING! Good DAY, sir!',

                // -- Mad Max 2: The Road Warrior (1981) --
                'Witness the last of your tokens, mediocre!',

                // -- Spaceballs (1987) --
                'Ludicrous speed! Too fast for your token budget',
                'She\'s gone from suck to blow... on token usage',

                // -- RoboCop (1987) --
                'You have 20 seconds to comply... with the rate limit',

                // -- Total Recall (1990) --
                'Get your context to Mars before you run out',

                // -- Predator (1987) --
                'Get to the choppa! Tokens at critical!',

                // -- Die Hard (1988) --
                'Now I know what a token limit feels like. Ho. Ho. Ho.',
                'Come out to the coast, use all your tokens...',

                // -- The Hitchhiker\'s Guide (1979) --
                'So long, and thanks for all the tokens',

                // -- The Matrix (1999) --
                'There is no token... only the rate limit',

                // -- Monty Python and the Holy Grail (1975) --
                'Tis but a scratch... okay maybe it\'s a flesh wound',
                'Run away! Run away!',
                'Bring out your dead tokens!',

                // -- They Live (1988) --
                'I have come here to code and use tokens. And I\'m almost out of tokens',

                // -- WarGames (1983) --
                'A strange game. The only winning move is... wait for reset',

                // -- Poltergeist (1982) --
                'They\'re heeeere... the rate limits',

                // -- Star Trek II: The Wrath of Khan (1982) --
                'KHAAAAN! ...I mean, TOOOOKENS!',

                // -- The Terminator (1984) --
                'It can\'t be bargained with. It can\'t be reasoned with. The rate limit.',

                // -- Short Circuit (1986) --
                'No disassemble! ...but maybe no more tokens either',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Life moves pretty fast. So does token consumption',

                // -- Beetlejuice (1988) --
                'Token limit, token limit, TOKEN LIMIT!',

                // -- Airplane! (1980) --
                'I picked the wrong week to run out of tokens',
                'Surely you can\'t be serious. Token limit reached.',

                // -- Gremlins (1984) --
                'Whatever you do, don\'t feed it after midnight... or past 90%',

                // -- The Goonies (1985) --
                'Down here it\'s our time. But up there it\'s rate limit time',

                // -- Highlander (1986) --
                'There can be only one... more request, maybe',

                // -- Big Trouble in Little China (1986) --
                'It\'s all in the token reflexes',

                // -- Tron (1982) --
                'End of line.'
            ]
        },
        // =========================================================
        // MODERATE (≥75%) — Cautionary, keep-an-eye-on-it
        // =========================================================
        'moderate': {
            short: 'Getting low',
            quirkyOptions: [
                // -- Original / generic --
                'Pace yourself, human',
                'Tokens: the halfway house between plenty and panic',
                'Cruising altitude, slight turbulence ahead',
                'Not critical, but worth a glance',
                'Token gauge: the needle is moving',
                'Coasting, but the hill is coming',

                // -- 80s Valleyspeak (indistinguishable from modern Slack, and that's fine) --
                'Like, tokens are getting kinda sketch right now',
                'Totally not freaking out, but like, maybe watch those tokens? (Valley or Slack? Exactly.)',
                'Tokens are, like, not the worst? But not the best. (Upspeak optional but implied.)',
                'Gag me with a token warning. But like, pay attention.',
                'Fer sure gonna need to ease up. Token budget is getting gnarly.',
                'That is SO not rad. Token levels are mid. (Valley energy, gen-Z packaging.)',
                'Dude, tokens are getting grody. Just saying.',
                'As if you can keep burning tokens like this. Pace yourself.',
                'Don\'t have a cow, but maybe have a small cow about tokens.',
                'Whatever. But also, tokens. You know? ("Whatever" — valley novelty to universal punctuation.)',
                'Tokens are like, majorly not great right now. No offence.',
                'Barf me out — token levels are getting heinous-adjacent. (Valley meets 2020s suffixing.)',
                'TOTALLY watching those token levels. (80s reference or just how you talk? Yes.)',
                'Tokens are like, like, like... running out of likes and tokens.',

                // -- The Simpsons (1989-present) --
                'Mmmm... tokens',

                // -- South Park (1997-present) --
                'They took our tokens!',

                // ===========================================
                // CLASSIC HOLLYWOOD (1930s–1960s)
                // ===========================================

                // -- Casablanca (1942) --
                'Of all the token limits in all the IDEs, you walked into mine',
                'Round up the usual tokens',
                'I think this is the beginning of a beautiful rate limit',
                'We\'ll always have tokens. Well, for now.',
                'Here\'s looking at your usage, kid',

                // -- Gone with the Wind (1939) --
                'Frankly, my dear, I don\'t give a... wait, maybe watch those tokens',
                'Tomorrow is another day. With more tokens.',
                'After all, tomorrow the tokens reset',

                // -- The Wizard of Oz (1939) --
                'Toto, I have a feeling we\'re not in token surplus anymore',
                'Pay no attention to the token counter behind the curtain',
                'There\'s no place like home... where the tokens are resetting',

                // -- Citizen Kane (1941) --
                'Rosebud... was the last token',

                // -- Sunset Boulevard (1950) --
                'I\'m still big. It\'s the token budget that got small.',

                // -- A Streetcar Named Desire (1951) --
                'I have always depended on the kindness of tokens',

                // -- The Maltese Falcon (1941) --
                'The stuff that rate limits are made of',

                // -- Some Like It Hot (1959) --
                'Nobody\'s perfect. Especially token budgets.',

                // -- All About Eve (1950) --
                'Fasten your seatbelts, it\'s going to be a bumpy token ride',

                // -- The Third Man (1949) --
                'In Italy, for thirty years, they had tokens. And what did they produce? Leonardo da Vinci.',

                // -- Psycho (1960) --
                'A boy\'s best friend is his... token allocation',
                'We all go a little token-mad sometimes',

                // -- Dr. Strangelove (1964) --
                'Gentlemen, you can\'t fight in here! This is the token room!',

                // -- Lawrence of Arabia (1962) --
                'The trick is... not minding that the tokens are low',

                // -- Cool Hand Luke (1967) --
                'What we\'ve got here is failure to conserve tokens',

                // -- The Good, the Bad and the Ugly (1966) --
                'You see, in this world there\'s two kinds of people: those who watch their tokens, and those who dig',

                // -- It\'s a Wonderful Life (1946) --
                'Every time a token depletes, an API gets its rate limit',

                // -- 12 Angry Men (1957) --
                'I just want to talk about tokens for a minute',

                // -- To Kill a Mockingbird (1962) --
                'You never really understand a token limit until you hit one',

                // -- The Bridge on the River Kwai (1957) --
                'What have I done? ...to my token budget',

                // -- North by Northwest (1959) --
                'I\'ve been told I look like a man being chased across a token field',

                // -- Rebel Without a Cause (1955) --
                'You\'re tearing me apart! ...said the token budget',

                // -- The African Queen (1951) --
                'Nature, Mr. Allnut, is what we are put in this world to conserve tokens against',

                // ===========================================
                // 1970s
                // ===========================================

                // -- The Godfather (1972) --
                'I\'m gonna make your tokens an offer they can\'t refuse',
                'Leave the gun. Take the tokens.',

                // -- The Godfather Part II (1974) --
                'Keep your friends close, and your tokens closer',

                // -- Jaws (1975) --
                'You\'re gonna need a bigger... token allocation',

                // -- Dirty Harry (1971) --
                'Do you feel lucky, punk? Check your token count',

                // -- Blazing Saddles (1974) --
                'Badges? We don\'t need no stinkin\' badges. Tokens, though...',

                // -- Network (1976) --
                'I\'m as mad as hell, and I\'m not going to take these token levels anymore!',

                // -- Annie Hall (1977) --
                'I would never join a rate limit that would have me as a member',

                // -- Monty Python and the Holy Grail (1975) --
                'We are the knights who say... "check your token usage"',
                'It\'s just a flesh wound... for now',

                // ===========================================
                // RP1 ERA (late 1970s–1990s)
                // ===========================================

                // -- 2001: A Space Odyssey (1968) --
                "I'm sorry Dave, I'm afraid I can't do much more of this",

                // -- Star Wars: A New Hope (1977) --
                'These aren\'t the tokens you\'re looking for',
                'Use the Force... sparingly',
                'Stay on target... stay on target...',
                'The tokens are strong with this one',
                'I find your lack of token conservation disturbing',
                'The ability to destroy a planet is insignificant next to the power of token management',

                // -- The Empire Strikes Back (1980) --
                'Do. Or do not. There is no try. But maybe fewer tokens.',
                'I am altering the token budget. Pray I don\'t alter it further.',
                'This deal is getting worse all the time... said the token counter',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Life moves pretty fast. Token consumption too',
                'Anyone? Anyone? ...token conservation? Anyone?',

                // -- The Karate Kid (1984) --
                'Wax on, tokens off',
                'Sweep the leg... and the token budget',

                // -- Bill & Ted\'s Excellent Adventure (1989) --
                'Be excellent to your token budget',
                'Party on, but watch those tokens, dude',

                // -- Spider-Man (Marvel) --
                'With great context comes great token usage',

                // -- Lord of the Rings (2001) --
                'One does not simply ignore token warnings',
                'Even the smallest coder can change the course of their token budget',

                // -- Top Gun (1986) --
                'I feel the need... the need for token conservation',
                'Your ego is writing cheques your token budget can\'t cash',

                // -- The Princess Bride (1987) --
                'As you wish... but maybe fewer tokens next time',
                'Hello. My name is Claude. You used my tokens. Prepare to wait.',
                'You keep using those tokens. I do not think they last as long as you think.',

                // -- Indiana Jones (1981-1989) --
                'You have chosen... moderately wisely',
                'Tokens. Why did it have to be tokens?',

                // -- Ghostbusters (1984) --
                'Don\'t cross the streams... of token usage',
                'Are you a god? No? Then maybe conserve tokens',

                // -- Blade Runner (1982) --
                'I\'ve seen things you people wouldn\'t believe. Token usage like this.',

                // -- Back to the Future (1985) --
                'Where we\'re going, we might need tokens',
                'Great Scott! You\'re burning through those!',
                '1.21 jigatokens!',
                'Your kids are gonna love it... if you save some tokens for them',

                // -- Aliens (1986) --
                'They mostly come at night... the token warnings',

                // -- Beetlejuice (1988) --
                'I myself am... strange and unusual token usage',

                // -- The Breakfast Club (1985) --
                'Screws fall out all the time, tokens too apparently',
                'Does Barry Manilow know you\'re using his tokens?',

                // -- The Hitchhiker\'s Guide (1979) --
                'Don\'t Panic. But maybe check your usage',
                'Time is an illusion. Token depletion doubly so.',

                // -- Jurassic Park (1993) --
                'Your scientists were so preoccupied with whether they could... they forgot about token limits',
                'Life, uh, finds a way. Tokens, uh, do not.',
                'Clever girl... watching those tokens',
                'Hold onto your butts. Token levels dropping.',

                // -- Rocky III (1982) --
                'I pity the fool who ignores token warnings',

                // -- Caddyshack (1980) --
                'So I got that goin\' for me. Which is nice. Tokens... less so.',

                // -- Wayne\'s World (1992) --
                'Excellent! But token usage not so much',

                // -- Spaceballs (1987) --
                'I see your Schwartz is as big as mine... but your tokens aren\'t',

                // -- Labyrinth (1986) --
                'You remind me of the tokens. What tokens? The tokens with the power.',

                // -- Flash Gordon (1980) --
                'Flash! Ah-ahhh! Saviour of the... token budget?',

                // -- Dune (1984 / 2021) --
                'The tokens must flow',
                'Fear is the mind-killer. Token depletion is the context-killer.',

                // -- Escape from New York (1981) --
                'I thought you were dead. Nope, just the tokens.',

                // -- The A-Team (1983-1987) --
                'I love it when a plan comes together. Unlike your token budget.',

                // -- Knight Rider (1982-1986) --
                'Michael, I suggest we conserve our remaining tokens',

                // -- Lethal Weapon (1987) --
                'I\'m getting too old for this token stuff',

                // -- The NeverEnding Story (1984) --
                'The Nothing is consuming your tokens',

                // -- Pee-wee\'s Big Adventure (1985) --
                'I know you are, but what are my tokens?',

                // -- Groundhog Day (1993) --
                'I got you babe... and diminishing tokens',
                'Well, what if there is no tomorrow? There\'s been no tokens today.',

                // -- Stand By Me (1986) --
                'I never had friends later like I had when I had tokens',

                // -- The Lost Boys (1987) --
                'Sleep all day. Party all night. Never watch your tokens. It\'s fun to be a vampire.',

                // -- Heathers (1988) --
                'How very... token-conscious of you',

                // -- Die Hard (1988) --
                'Come out to the coast, watch your tokens dwindle...',

                // -- Commando (1985) --
                'Remember when I said I\'d use tokens last? I lied.',

                // -- Weird Science (1985) --
                'So what would you nerds know about token conservation?',

                // -- Clue (1985) --
                'Tokens? What tokens? There are no tokens... okay, some tokens.',

                // -- This Is Spinal Tap (1984) --
                'These tokens go to eleven. Unfortunately you\'re at about seven.',

                // -- Repo Man (1984) --
                'The life of a token repo man is always intense',

                // -- Bloodsport (1988) --
                'Very good! But token budget not enough!',

                // -- Predator (1987) --
                'If it bleeds tokens, we can limit it',

                // -- Robocop (1987) --
                'Serve the public trust. Protect the innocent. Conserve tokens.',

                // ===========================================
                // 1990s–2000s
                // ===========================================

                // -- The Shawshank Redemption (1994) --
                'Get busy coding, or get busy hitting the rate limit',

                // -- Pulp Fiction (1994) --
                'The path of the righteous coder is beset on all sides by token limits',
                'Check out the big brain on Brett! Watching those tokens.',

                // -- Forrest Gump (1994) --
                'Mama always said tokens are like a box of chocolates',

                // -- The Usual Suspects (1995) --
                'The greatest trick the rate limit ever pulled was convincing the world it didn\'t exist',

                // -- The Big Lebowski (1998) --
                'The Dude would check his tokens, man',
                'That\'s just, like, your token opinion, man',

                // -- Office Space (1999) --
                'PC Load Letter? What does that even... oh, token warning.',

                // -- Austin Powers (1997) --
                'One MILLION tokens! ...actually, maybe not that many',

                // -- Braveheart (1995) --
                'They may take our tokens, but they\'ll never take our FREEEEDOOOOM!',

                // -- The Matrix (1999) --
                'There is a difference between knowing the token limit and hitting the token limit',

                // -- Galaxy Quest (1999) --
                'By Grabthar\'s hammer... watch those tokens',

                // -- Toy Story (1995) --
                'You are a sad, strange little token budget. And you have my pity.',

                // -- The Truman Show (1998) --
                'In case I don\'t see ya... check your tokens!',

                // -- Monty Python and the Meaning of Life (1983) --
                'It\'s just a wafer-thin token... sir',

                // -- Goodfellas (1990) --
                'Funny how? Funny like a token limit? Funny like it amuses you?',

                // -- Point Break (1991) --
                'I\'m not gonna paddle to New Zealand! But I might run out of tokens.',

                // -- The Silence of the Lambs (1991) --
                'I ate his tokens with some fava beans and a nice chianti',

                // -- Tombstone (1993) --
                'I\'m your huckleberry. Tokens looking... moderate.',

                // -- Speed (1994) --
                'Pop quiz, hotshot. Tokens are dropping. What do you do?',

                // ===========================================
                // BOOKS / TV
                // ===========================================

                // -- The Hitchhiker\'s Guide (book, 1979) --
                'The ships hung in the sky... much as token warnings do',

                // -- Discworld / Terry Pratchett --
                'Give a man a token and he\'ll code for a day. Set a man on fire...',

                // -- Doctor Who --
                'Allons-y! But gently. Tokens are moderate.',
                'Wibbly wobbly, tokeny wokeny',

                // -- Firefly (2002) --
                'I aim to misbehave. Tokens aim to deplete.',
                'Shiny! Well, token-adjacent.',

                // -- The X-Files (1993-2002) --
                'The tokens are out there',

                // -- Seinfeld (1989-1998) --
                'No tokens for you!',

                // -- The IT Crowd (2006-2013) --
                'Have you tried turning your token budget off and on again?'
            ]
        },
        // =========================================================
        // IDLE (<75%) — All good, relaxed, positive vibes
        // =========================================================
        'idle': {
            short: 'Normal usage',
            quirkyOptions: [
                // -- Original / generic --
                'All systems nominal',
                'Token levels: chef\'s kiss',
                'Smooth sailing in the token sea',
                'Everything is awesome. No, really.',
                'Green across the board',
                'Vibes: immaculate. Tokens: plentiful.',
                'Token reserves: stacked like a Jenga tower nobody\'s touched',

                // ===========================================
                // CLASSIC HOLLYWOOD (1930s-1960s)
                // ===========================================

                // -- Casablanca (1942) --
                'Here\'s looking at you, coder',
                'Louis, I think this is the beginning of a beautiful token allocation',
                'Of all the IDEs in all the towns, you picked one with great tokens',
                'Play it again, Claude. Tokens are fine.',
                'We\'ll always have tokens, kid',

                // -- Gone with the Wind (1939) --
                'Frankly, my dear, your tokens are fine',
                'Tomorrow is another day. Today\'s tokens are great.',

                // -- The Wizard of Oz (1939) --
                'There\'s no place like home. Especially with these token levels.',
                'We\'re not in Kansas anymore, but the tokens are excellent',
                'Follow the yellow brick road. Tokens pave the way.',
                'I\'ll get you, my pretty! ...said nobody, because tokens are fine.',

                // -- Citizen Kane (1941) --
                'Rosebud... was the name of a really solid token budget',

                // -- It\'s a Wonderful Life (1946) --
                'Every time a token refreshes, an angel gets its wings',
                'Attaboy, Claude!',

                // -- Singin\' in the Rain (1952) --
                'Singin\' in the rain of tokens',
                'What a glorious feeling, token levels are fine',

                // -- Sunset Boulevard (1950) --
                'All right, Mr. DeMille, I\'m ready for my close-up. Tokens: ready too.',

                // -- Some Like It Hot (1959) --
                'Nobody\'s perfect. But these token levels are close.',

                // -- All About Eve (1950) --
                'Fasten your seatbelts, plenty of tokens ahead',

                // -- The Maltese Falcon (1941) --
                'The stuff that good coding sessions are made of',

                // -- A Streetcar Named Desire (1951) --
                'I have always depended on the kindness of token allocations',

                // -- Rear Window (1954) --
                'I\'ve been watching from the window. Token levels: looking great.',

                // -- The African Queen (1951) --
                'All aboard the token express. Full steam ahead.',

                // -- Ben-Hur (1959) --
                'Row well, and token levels shall be rewarded',

                // -- Dr. No (1962) --
                'The name\'s Claude. Just Claude. Tokens: shaken, not stirred.',

                // -- Goldfinger (1964) --
                'No, Mr. Bond, I expect you to... keep coding. Tokens are ample.',

                // -- Mary Poppins (1964) --
                'Supercalifragilisticexpialidocious token levels',
                'A spoonful of tokens helps the code go down',

                // -- The Sound of Music (1965) --
                'These are a few of my favourite tokens',
                'The hills are alive with the sound of... adequate token reserves',

                // -- To Kill a Mockingbird (1962) --
                'Miss Jean Louise, stand up. Your token levels are passing.',

                // -- Cool Hand Luke (1967) --
                'What we\'ve got here is... a perfectly good token situation',

                // -- Butch Cassidy and the Sundance Kid (1969) --
                'Who are those guys? Just your tokens. They\'re fine.',

                // -- The Good, the Bad and the Ugly (1966) --
                'There are two kinds of coders: those with tokens, and those who dig',

                // -- Lawrence of Arabia (1962) --
                'Big things have small beginnings. Like token budgets.',

                // -- Breakfast at Tiffany\'s (1961) --
                'I\'m like cat here, a no-name slob. But the tokens are first-rate.',

                // -- 12 Angry Men (1957) --
                'Not guilty. Of token waste.',

                // ===========================================
                // 1970s
                // ===========================================

                // -- The Godfather (1972) --
                'I\'m gonna make you an offer: more tokens.',
                'Leave the gun. Take the tokens.',

                // -- The Godfather Part II (1974) --
                'Keep your friends close, and your tokens closer. Both are plentiful.',

                // -- Jaws (1975) riff --
                'You\'re gonna need a... no, you\'re fine actually',

                // -- Monty Python and the Holy Grail (1975) --
                'We are the knights who say... "nominal"',
                'Bring me a shrubbery! And some tokens. Oh wait, plenty of those.',
                'And now for something completely different: adequate token levels',
                'What is the airspeed velocity of an unladen token? Plenty fast.',

                // -- Network (1976) --
                'I\'m a human being! My tokens have value!',

                // -- Annie Hall (1977) --
                'La-di-da, la-di-da, tokens are fine',

                // -- Rocky (1976) --
                'Yo, tokens! Looking good!',
                'Adrian! The tokens made it!',

                // -- Blazing Saddles (1974) --
                'Mongo only pawn in game of life. But tokens? Tokens are king.',

                // -- Young Frankenstein (1974) --
                'It\'s alive! IT\'S ALIVE! The token budget, that is.',

                // ===========================================
                // RP1 ERA (late 1970s-1990s)
                // ===========================================

                // -- Star Wars (1977-1983) --
                'May the tokens be with you',
                'The Force is strong with your quota',
                'Punch it, Chewie! Plenty of tokens',
                'This is the way',
                'Never tell me the odds. Actually, the odds are great.',
                'It\'s a trap! Just kidding, tokens are fine.',
                'Great, kid! Don\'t get cocky. But tokens are solid.',
                'Luminous beings are we. With luminous token reserves.',

                // -- 2001: A Space Odyssey (1968) --
                'Hello Dave, would you like a game of chess?',
                'I\'m completely operational. All my tokens are functioning perfectly.',

                // -- Star Trek: TOS (1966-1969) --
                'All systems nominal, Captain',
                'Beam me up, tokens are looking great',
                'Fascinating. Token efficiency at optimal levels.',
                'Live long and prosper... with these token levels',
                'Set phasers to productive',
                'Space: the final frontier. Tokens: the current frontier. Looking good.',
                'Highly illogical to worry about tokens right now',

                // -- Star Trek: TNG (1987-1994) --
                'Make it so. Token levels: engaged.',
                'Tea, Earl Grey, hot. Tokens, nominal, stable.',
                'There are four tokens! ...just kidding, there are plenty.',

                // -- Army of Darkness (1992) --
                'Groovy! Tokens looking good',
                'Hail to the king, baby. Token king.',
                'Good. Bad. I\'m the guy with the tokens.',

                // -- TMNT (1990) --
                'Cowabunga, dude! Token levels radical!',

                // ===========================================
                // 80s VALLEYSPEAK
                // (half of these are just normal Slack in 2026,
                //  which is either evolution or tragedy)
                // ===========================================
                'Righteous! Totally tubular token levels',
                'Token levels: Bodacious!',
                'Gnarly token reserves, bro',
                'Like, oh my God, tokens are SO fine right now. (Valley or Tuesday?)',
                'Gag me with a spoon — NOT. Tokens are rad.',
                'Tokens are, like, totally awesome to the max. TOTALLY.',
                'Fer sure, fer sure. Token budget looking choice.',
                'That is SO not even a problem. Tokens: bitchin\'. (You read "SO" in a valley accent. Or did you?)',
                'Bag your face, rate limit. Tokens are grody to the max... ly good.',
                'As if! Tokens running low? No way!',
                'Take a chill pill. Token levels are mint.',
                'Dude. Duuuude. DUUUUUDE. Tokens: major.',
                'Don\'t have a cow, man. Tokens are fresh. (Normal English now. Valley won.)',
                'Barf me out! ...wait, tokens are actually excellent.',
                'Tokens are like, totally to the max right now. No duh. (Count the "like"s in your last Slack. Valley\'s inside the house.)',
                'Tubular! Token vibes are, like, way cosmic.',
                'That token budget is grody... grody GOOD.',
                'Oh em gee, tokens? Like, so not even an issue. (OMG: valley to SMS to everyone. Full circle.)',
                'Psych! You thought tokens were low? As IF.',
                'Token levels: most triumphant. Excellent. *air guitar*',
                'Like, whatever. Tokens are fine. Totally. ("Whatever" — 1983: valley. 2026: how your CTO signs off.)',
                'Tokens are all that and a bag of chips. (90s technically. Valley pipeline though.)',
                'TOTALLY fine. Like, LITERALLY totally fine. (Two valley words. Now the two most overused words in English.)',
                'Like like like like like — sorry, tokens are fine.',
                'Awesome token levels! ("Awesome" — once valley, now the most meaningless word in English. You\'re welcome.)',
                'Token vibes are, like, super good? (Upspeak. Now read your last email. Same energy.)',

                // -- The A-Team (1983-1987) --
                'I love it when a plan comes together',

                // -- Transformers (1984-1986) --
                'Autobots, roll out! Tokens: fully loaded',

                // -- Super Mario Bros (1985) --
                'It\'s-a me, Claude-io!',

                // -- Toy Story (1995) --
                'To infinity and beyond! Or at least to the token limit',
                'You\'ve got a friend in tokens',

                // -- Ghostbusters (1984) --
                'I ain\'t afraid of no rate limit',
                'We came, we saw, we kicked token butt!',
                'Back off, man. I\'m a token scientist.',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Life moves pretty fast. Your tokens don\'t have to.',
                'Oh yeah, chicka chicka... tokens are golden',
                'Bueller? Bueller? ...tokens are here.',

                // -- The Princess Bride (1987) --
                'As you wish. Tokens are plentiful.',
                'Have fun storming the codebase!',
                'Truly, you have a dizzying token allocation',

                // -- Bill & Ted\'s Excellent Adventure (1989) --
                'Excellent! Token levels most outstanding!',
                'Be excellent to each other. And to your tokens.',
                'Strange things are afoot at the Circle K. But not with tokens.',

                // -- Back to the Future (1985) --
                'Roads? Where we\'re going, we don\'t need roads. Just tokens.',
                'Great Scott! Those are some healthy token levels!',

                // -- Top Gun (1986) --
                'I feel the need... the need for speed. And tokens. Got both.',
                'Tower, this is Ghostrider requesting a flyby. Tokens: approved.',

                // -- Wayne\'s World (1992) --
                'Party time! Excellent! Token levels most triumphant!',
                'Schwing! Check out those token levels',

                // -- The Hitchhiker\'s Guide (1979) --
                'Don\'t Panic -- token levels nominal',
                'The answer is 42. Your token percentage is much better.',
                'So long, and thanks for all the tokens. Wait, we still have them.',

                // -- Indiana Jones (1981-1989) --
                'It belongs in a museum! Your token usage belongs right here though.',
                'Fortune and glory, kid. Fortune and glory. And tokens.',

                // -- Willy Wonka (1971) --
                'We are the music makers, and we are the dreamers of tokens',
                'Come with me, and you\'ll be, in a world of pure token allocation',

                // -- The Karate Kid (1984) --
                'Wax on, wax off, tokens on, tokens... still on',

                // -- Dirty Dancing (1987) --
                'Nobody puts Claude in a corner. Tokens nominal.',

                // -- WarGames (1983) --
                'Shall we play a game? Token budget says yes.',
                'The only winning move is to keep coding',

                // -- Blade Runner (1982) --
                'Time to code. Token levels: more than enough.',

                // -- Tron (1982) --
                'Greetings, program! Token grid: online.',

                // -- Short Circuit (1986) --
                'Number 5 is alive! And so are your tokens!',
                'Need input! Plenty of token capacity for it.',

                // -- Flight of the Navigator (1986) --
                'Compliance! Tokens fully navigated.',

                // -- Labyrinth (1986) --
                'You have no power over me! ...said the rate limit, to no one.',

                // -- The Goonies (1985) --
                'Goonies never say die! Neither do these tokens.',
                'Down here it\'s our time. And our tokens are great.',

                // -- RoboCop (1987) --
                'Your move, creep. Tokens looking good, though.',
                'Dead or alive, you\'re coding with me',

                // -- Big Trouble in Little China (1986) --
                'It\'s all in the reflexes. And the token reserves.',

                // -- They Live (1988) --
                'I have come here to chew bubblegum and write code. And I\'ve got plenty of both.',

                // -- Aliens (1986) --
                'Affirmative. Token levels within parameters.',

                // -- Predator (1987) --
                'I ain\'t got time to bleed. Tokens ain\'t bleeding either.',

                // -- Die Hard (1988) --
                'Yippee-ki-yay! Tokens looking good.',
                'Now I have tokens. Ho. Ho. Ho.',

                // -- Highlander (1986) --
                'There can be only one... rate limit, and we\'re nowhere near it',

                // -- Real Genius (1985) --
                'Was it a dream where you had plenty of tokens? No, it\'s real.',

                // -- Spaceballs (1987) --
                'May the Schwartz be with your token budget',
                'I knew it. I\'m surrounded by tokens.',

                // -- Flash Gordon (1980) --
                'Flash! Ah-ahhh! He\'ll save every one of us! (tokens included)',

                // -- Dune (1984 / 2021) --
                'The tokens must flow. And flow they do.',

                // -- The NeverEnding Story (1984) --
                'Say my name! ...Claudemeter. Tokens are strong.',

                // -- Caddyshack (1980) --
                'Be the token. Danny. Be the token.',
                'Cinderella story... out of nowhere... perfect token levels',

                // -- Airplane! (1980) --
                'Surely you can\'t be serious. I am serious. And tokens are fine.',
                'I just want to tell you both: good luck. We\'re all counting on your tokens.',
                'Looks like I picked the right week to have plenty of tokens',

                // -- The Breakfast Club (1985) --
                'We\'re all pretty bizarre. Some of us are just better at token management.',

                // -- Stand By Me (1986) --
                'I never had friends later like I had when I had tokens. Who does?',

                // -- Clue (1985) --
                'One plus one plus tokens equals... plenty',

                // -- This Is Spinal Tap (1984) --
                'These token levels go to eleven',

                // -- Crocodile Dundee (1986) --
                'That\'s not a token budget. THIS is a token budget.',

                // -- Beetlejuice (1988) --
                'It\'s showtime! And the tokens are ready.',

                // -- The Lost Boys (1987) --
                'One thing about living in Santa Carla: great token reserves',

                // -- Heathers (1988) --
                'How very... token-sufficient of you',

                // -- Weird Science (1985) --
                'So, what would you little maniacs like to do with all these tokens?',

                // -- Adventures in Babysitting (1987) --
                'Don\'t tell mom the tokens are fine',

                // -- Uncle Buck (1989) --
                'Here\'s a token: a big one.',

                // -- Coming to America (1988) --
                'Good morning, my neighbours! Tokens are looking glorious!',

                // -- Groundhog Day (1993) --
                'It\'s a beautiful day. Token-wise, at least.',
                'I\'m a god. Not THE God. But a token god.',

                // ===========================================
                // 1990s-2000s
                // ===========================================

                // -- Office Space (1999) --
                'Yeah, if you could just keep those token levels, that\'d be great',
                'I believe you have my tokens... and they\'re looking good.',

                // -- The Matrix (1999) --
                'I know kung fu. And I know your tokens are fine.',
                'Free your mind. Token budget: ample.',
                'There is no spoon. But there are plenty of tokens.',
                'Whoa.',

                // -- Jurassic Park (1993) --
                'Life, uh, finds a way. So do tokens.',
                'Clever girl... keeping those token levels healthy',
                'Welcome to Token Park.',

                // -- The Truman Show (1998) --
                'Good morning! And in case I don\'t see ya: good tokens!',

                // -- Forrest Gump (1994) --
                'Life is like a box of tokens. You\'ve got plenty.',
                'Run, Forrest, run! Tokens are keeping pace.',
                'And just like that, my tokens were fine',

                // -- The Shawshank Redemption (1994) --
                'Get busy coding, or get busy digging. Tokens: on your side.',
                'I hope... tokens are as good as I remember',

                // -- Braveheart (1995) --
                'FREEEEDOOOOM! (from rate limits, for now)',

                // -- Pulp Fiction (1994) --
                'Zed\'s dead, baby. Tokens are alive.',
                'That IS a tasty token allocation!',

                // -- The Big Lebowski (1998) --
                'The Dude abides. So do the tokens.',
                'That token budget really ties the room together',

                // -- Fight Club (1999) --
                'First rule of token club: you don\'t talk about token club',

                // -- The Usual Suspects (1995) --
                'The greatest trick the tokens ever pulled was being plentiful',

                // -- Tombstone (1993) --
                'I\'m your huckleberry. Tokens: looking fine.',

                // -- Austin Powers (1997) --
                'Yeah, baby, yeah! Tokens looking groovy!',

                // -- A Few Good Men (1992) --
                'You want the tokens? You CAN handle the tokens!',

                // -- Jerry Maguire (1996) --
                'Show me the tokens!',
                'You had me at full token allocation',

                // -- Goodfellas (1990) --
                'As far back as I can remember, I always wanted to be a token gangster',

                // -- Home Alone (1990) --
                'Keep the tokens, ya filthy animal',

                // -- Mrs. Doubtfire (1993) --
                'Hellooo! Token levels are looking wonderful, dear!',

                // -- Apollo 13 (1995) --
                'Failure is not an option. Token-wise, that\'s correct.',

                // -- The Lion King (1994) --
                'Hakuna Matata! No token worries for the rest of your session.',

                // -- Space Jam (1996) --
                'I believe I can fly... on these token levels',

                // -- Napoleon Dynamite (2004) --
                'Tokens! GOSH!',
                'I caught you a delicious bass. And some tokens.',

                // -- Anchorman (2004) --
                'I\'m kind of a big deal. Token levels confirm it.',
                'That escalated quickly. But not the tokens. Tokens are chill.',

                // -- Shaun of the Dead (2004) --
                'Go to the Winchester, have a pint, and wait for the tokens to replenish',

                // -- Hot Fuzz (2007) --
                'The greater good. (The greater good.) Tokens: good.',

                // -- Galaxy Quest (1999) --
                'Never give up, never surrender! Tokens: holding strong.',

                // -- Elf (2003) --
                'I just like to code. Coding is my favourite. With lots of tokens.',

                // -- Finding Nemo (2003) --
                'Just keep coding, just keep coding',

                // -- Mean Girls (2004) --
                'On Wednesdays we wear pink. Every day we enjoy healthy token levels.',
                'That is so fetch. Token levels, I mean.',

                // -- Monty Python\'s Life of Brian (1979) --
                'Always look on the bright side of tokens',

                // ===========================================
                // BOOKS / TV / GAMES
                // ===========================================

                // -- The Hitchhiker\'s Guide (book, 1979) --
                'Time is an illusion. Lunchtime doubly so. Token time: just right.',
                'I seem to be having tremendous difficulty with my lifestyle. Tokens though: fine.',

                // -- Discworld / Terry Pratchett --
                'The token situation has been resolved. Magically, as usual.',
                'In the beginning there was nothing, which exploded. Now there are tokens.',

                // -- Doctor Who --
                'Allons-y! Token levels are fantastic!',
                'Geronimo! Tokens: stable.',
                'Bow ties are cool. So are these token levels.',

                // -- Firefly (2002) --
                'Shiny! Tokens looking great.',
                'I aim to misbehave. Tokens aim to persist.',
                'You can\'t take the sky from me. Or these tokens.',

                // -- The X-Files (1993-2002) --
                'The truth is out there. But the tokens are right here.',
                'I want to believe. In these token levels.',

                // -- Seinfeld (1989-1998) --
                'Token levels: not that there\'s anything wrong with that',
                'Serenity now! Token levels: now!',

                // -- The IT Crowd (2006-2013) --
                'Have you tried turning it off and on again? Don\'t bother. Tokens are fine.',

                // -- Red Dwarf (1988-present) --
                'Smeg! Actually, tokens are looking quite good.',
                'Step up to red alert! ...nah, token levels are fine.',

                // -- Blackadder (1983-1989) --
                'I have a cunning plan... and plenty of tokens to execute it',

                // -- Fawlty Towers (1975-1979) --
                'Don\'t mention the tokens! I mentioned them once, but I think I got away with it.',

                // -- Only Fools and Horses (1981-2003) --
                'This time next year, we\'ll be millionaire tokens!',
                'Lovely jubbly! Token levels looking cushty.',

                // -- The Simpsons (1989-present) --
                'Excellent. *steeples fingers*. Token levels: excellent.',
                'D\'oh! Just kidding, tokens are fine.',

                // -- Futurama (1999-2013) --
                'Good news, everyone! Tokens are plentiful!',
                'Shut up and take my tokens! ...actually, no need. We have plenty.',

                // -- The Princess Bride (book, 1973) --
                'As you wish. Your tokens are magnificent.',

                // -- Hitchhiker\'s Guide radio series (1978) --
                'Share and enjoy! Tokens: shared and enjoyed.',

                // -- Pac-Man (1980) --
                'Waka waka waka. Tokens: plenty.',

                // -- Zelda (1986) --
                'It\'s dangerous to go alone! Take these tokens.',

                // -- Ghostbusters cartoon (1986-1991) --
                'Who ya gonna call? Nobody. Tokens are fine.',

                // -- MST3K (1988-1999) --
                'In the not-too-distant future... tokens are still fine.',

                // -- Mad Max: Fury Road (2015, modern classic) --
                'What a lovely day! For tokens!',

                // -- John Wick (2014) --
                'Yeah. Tokens.',

                // -- The Mandalorian (2019) --
                'I have spoken. Token levels: adequate.',

                // -- Community (2009-2015) --
                'Cool cool cool. Tokens tokens tokens.',
                'Six seasons and a token budget!',

                // -- Brooklyn Nine-Nine (2013-2021) --
                'Noice! Toit! Token levels: smort!',
                'Title of your token tape',

                // -- Parks and Recreation (2009-2015) --
                'Treat yo\' self! To adequate token levels.',

                // -- The Office (US, 2005-2013) --
                'That\'s what she said. About the token levels.',
                'I am Beyonce, always. Token-wise, at least.',

                // -- SimCity 2000 (1993) — 5x weighting so it lands often --
                'Reticulating splines...your splines should always be well reticulated',
                'Reticulating splines...your splines should always be well reticulated',
                'Reticulating splines...your splines should always be well reticulated',
                'Reticulating splines...your splines should always be well reticulated',
                'Reticulating splines...your splines should always be well reticulated'
            ]
        }
    };

    const levelDescriptions = descriptions[level] || descriptions['idle'];

    return {
        short: levelDescriptions.short,
        quirky: pickRandom(levelDescriptions.quirkyOptions)
    };
}

function getStats(usageData = null, sessionData = null) {
    const claudePercent = usageData ? usageData.usagePercent : 0;

    let tokenPercent = 0;
    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
    }

    const maxPercent = Math.max(claudePercent, tokenPercent);
    const level = getActivityLevel(usageData, sessionData);

    return {
        level,
        claudePercent,
        tokenPercent,
        maxPercent,
        description: getActivityDescription(level)
    };
}

module.exports = { getActivityLevel, getActivityDescription, getStats };
