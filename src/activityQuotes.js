// Project:   Claudemeter
// File:      activityQuotes.js
// Purpose:   Pop-culture quirky status quotes for the activity-level
//            tier descriptions. Extracted from activityMonitor.js
//            (which is now under 100 lines after the split) so the
//            data lives separately from the level-resolution logic.
//
//            Schema:
//              ACTIVITY_DESCRIPTIONS[level] = {
//                short:         'Running low!',
//                quirkyOptions: ['quote 1', 'quote 2', ...],
//              }
//            Levels: 'heavy' (>=90%), 'moderate' (>=75%), 'idle' (<75%).
//
//            Quote weighting: a quote appearing N times in quirkyOptions
//            gets Nx chance of being picked by pickRandom (uniform
//            random over the array). When a single concept warrants
//            heavier weighting (e.g. the SimCity 2000 'Reticulating
//            splines' loading message), prefer N distinct variations
//            on the theme over N copies of the same line - same
//            weighting effect, no repeated-quote fatigue.
//
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const ACTIVITY_DESCRIPTIONS = {
        // =========================================================
        // HEAVY (>=90%) - Critical warnings, dramatic tension
        // =========================================================
        'heavy': {
            short: 'Running low!',
            quirkyOptions: [
                // -- Original / generic --
                'Claude needs a coffee break soon',
                'Token reserves: practically decorative at this point',
                'Current trajectory: wall',

                // -- 80s Valleyspeak (now just... speak) --
                'Like, oh my God, tokens are SO dead right now.',
                'Gag me with a rate limit!',
                'Token budget: grody to the max.',
                'Totally buggin token limit',
                'Barf me out! Token levels are heinous!',
                'Fer sure you\'re gonna hit that limit. Fer sure fer sure.',
                'Gag! Token vibes are, like, way harsh right now.',
                'Like, whatever, but your tokens are like totally trashed. Like.',

                // -- South Park (1997-present) --
                'You are about to respect the rate limit authoritah!!',
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
                'Winter is coming for your context window',

                // -- Lord of the Rings (2001) --
                'You shall not pass much more through this context',

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

                // -- Alien (1979) --
                'In space, no one can hear you hit your limit',

                // -- Willy Wonka (1971) --
                'You get NOTHING! Good DAY, sir!',

                // -- Mad Max 2: The Road Warrior (1981) --
                'Witness the last of your tokens!',

                // -- Spaceballs (1987) --
                'Ludicrous speed! Too fast for your token budget',

                // -- RoboCop (1987) --
                'You have 20 seconds to comply with the rate limit',

                // -- Predator (1987) --
                'Get to the chopper! Tokens at critical!',

                // -- Die Hard (1988) --
                'Now I know what a token limit feels like. Ho. Ho. Ho.',

                // -- The Hitchhiker\'s Guide (1979) --
                'So long, and thanks for all the tokens',

                // -- The Matrix (1999) --
                'There is no token... only the rate limit',

                // -- Monty Python and the Holy Grail (1975) --
                'Run away! Run away!',
                'Bring out your dead tokens!',

                // -- They Live (1988) --
                'I came here to code and use tokens. And I\'m almost out of tokens',

                // -- WarGames (1983) --
                'A strange token game. The only winning move is... wait for reset',

                // -- Poltergeist (1982) --
                'They\'re heeeere... the rate limits',

                // -- The Terminator (1984) --
                'It can\'t be bargained with. It can\'t be reasoned with. The rate limit.',

                // -- Short Circuit (1986) --
                'No disassemble!',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Life moves pretty fast. So does token consumption',

                // -- Beetlejuice (1988) --
                'Token limit, token limit, TOKEN LIMIT!',

                // -- Airplane! (1980) --
                'I picked the wrong week to run out of tokens',
                'Surely you can\'t be serious. I am serious. And these tokens aren\'t.',

                // -- Gremlins (1984) --
                'Whatever you do, don\'t feed your LLM after midnight... or token consumption past 90%',

                // -- The Goonies (1985) --
                'Down here it\'s our time. Up there, it\'s rate-limit time.',

                // -- Highlander (1986) --
                'There can be only one... more request... maybe',

                // -- Tron (1982) --
                'End of line.'
            ]
        },
        // =========================================================
        // MODERATE (>=75%) - Cautionary, keep-an-eye-on-it
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
                'Totally not freaking out, but like, maybe watch those tokens?',
                'Tokens are, like, not the worst? But not the best.',
                'Gag me with a token warning. But like, pay attention.',
                'Fer sure gonna need to ease up. Token budget is getting gnarly.',
                'That is SO not rad. Token levels are mid.',
                'Dude, tokens are getting grody. Just saying.',
                'As if you can keep burning tokens like this. Pace yourself.',
                'Don\'t have a cow, but maybe have a small cow about tokens.',
                'Whatever. But also, tokens. You know?',
                'Tokens are like, majorly not great right now. No offence.',
                'Barf me out — token levels are getting heinous-adjacent.',
                'TOTALLY watching those token levels.',
                'Tokens are like, like, like... running out of likes and tokens.',

                // -- The Simpsons (1989-present) --
                'Mmmm... tokens',

                // -- South Park (1997-present) --
                'They took our jobs! ...using own tokens!',

                // ===========================================
                // CLASSIC HOLLYWOOD (1930s-1960s)
                // ===========================================

                // -- Casablanca (1942) --
                'Round up the usual tokens',
                'We\'ll always have tokens.',
                'Here\'s looking at your usage, kid',

                // -- Gone with the Wind (1939) --
                'Tomorrow is another day. With more tokens.',
                'After all, tomorrow the tokens reset',

                // -- The Wizard of Oz (1939) --
                'Toto, I have a feeling we\'re not in token surplus anymore',
                'Pay no attention to the token counter behind the curtain',

                // -- Citizen Kane (1941) --
                'Rosebud... was the last token',

                // -- Sunset Boulevard (1950) --
                'I\'m still big. It\'s the token budget that got small.',

                // -- The Maltese Falcon (1941) --
                'The stuff that rate limits are made of',

                // -- Some Like It Hot (1959) --
                'Nobody\'s perfect. Especially your token budget.',

                // -- Psycho (1960) --
                'A boy\'s best friend is his... token allocation',
                'We all go a little token-mad sometimes',

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

                // ===========================================
                // 1970s
                // ===========================================

                // -- The Godfather (1972) --
                'I\'m gonna make your tokens an offer they can\'t refuse',
                'Leave the gun. Take the tokens.',

                // -- Jaws (1975) --
                'You\'re gonna need a bigger... token allocation',

                // -- Dirty Harry (1971) --
                'Do you feel lucky, punk? Check your token count',

                // -- Network (1976) --
                'I\'m as mad as hell, and I\'m not going to take these token levels anymore!',

                // -- Monty Python and the Holy Grail (1975) --
                'We are the knights who say... "tokens!"',

                // ===========================================
                // RP1 ERA (late 1970s-1990s)
                // ===========================================

                // -- 2001: A Space Odyssey (1968) --
                "I'm sorry Dave, I'm afraid I can't do much more of this",

                // -- Star Wars: A New Hope (1977) --
                'These aren\'t the tokens you\'re looking for',
                'Stay on target... stay on target...',
                'The tokens are strong with this one',
                'I find your lack of token conservation disturbing',
                'The ability to destroy a planet is insignificant next to the power of a token budget',

                // -- The Empire Strikes Back (1980) --
                'I am altering the token budget. Pray I don\'t alter it further.',
                'This token deal is getting worse all the time',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Anyone? Anyone? ...token conservation? Anyone?',

                // -- Bill & Ted\'s Excellent Adventure (1989) --
                'Be excellent to your token budget',

                // -- Spider-Man (Marvel) --
                'With great context comes great token usage',

                // -- Lord of the Rings (2001) --
                'One does not simply ignore token warnings',
                'Even the smallest coder can change the course of their token budget',

                // -- Top Gun (1986) --
                'I feel the need... the need for token conservation',
                'Your ego is writing cheques your token budget can\'t cash',

                // -- The Princess Bride (1987) --
                'Hello. My name is Claude. You used my tokens. Prepare to wait.',
                'You keep using those tokens. I do not think they last as long as you think.',

                // -- Indiana Jones (1981-1989) --
                'You have chosen... moderately wisely',
                'Tokens. Why did it have to be tokens?',

                // -- Ghostbusters (1984) --
                'Don\'t cross the streams... of token usage',
                'Are you a god? No? Then maybe conserve tokens',

                // -- Back to the Future (1985) --
                'Great Scott! You\'re burning through those!',
                '1.21 jigatokens!',

                // -- Aliens (1986) --
                'The token warnings mostly come at night...',

                // -- The Breakfast Club (1985) --
                'Does Barry Manilow know you\'re using his tokens?',

                // -- The Hitchhiker\'s Guide (1979) --
                'Don\'t Panic. But maybe check your usage',
                'Time is an illusion. Token depletion doubly so.',

                // -- Jurassic Park (1993) --
                'Your scientists were so preoccupied with whether they could, they didn\'t stop to think about token limits',
                'Life, uh, finds a way. Tokens, uh, do not.',
                'Hold onto your butts. Token levels dropping.',

                // -- Rocky III (1982) --
                'I pity the fool who ignores token warnings',

                // -- Labyrinth (1986) --
                'You remind me of the tokens. What tokens? The tokens with the power.',

                // -- Flash Gordon (1980) --
                'Flash! Ah-ahhh! Saviour of your token budget!',

                // -- Dune (1984 / 2021) --
                'The tokens must flow',
                'Token depletion is the mind-killer.',

                // -- The A-Team (1983-1987) --
                'I love it when a plan comes together. Unlike your token budget.',

                // -- Lethal Weapon (1987) --
                'I\'m getting too old for this token stuff',

                // -- The NeverEnding Story (1984) --
                'The Nothing is consuming your tokens',

                // -- Groundhog Day (1993) --
                'Well, what if there is no tomorrow? There\'s been no tokens today.',

                // -- The Lost Boys (1987) --
                'Sleep all day. Party all night. Never watch your tokens. It\'s fun to be a vampire.',

                // -- Heathers (1988) --
                'How very... token-conscious of you',

                // -- Commando (1985) --
                'Remember when I said I\'d use tokens last? I lied.',

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
                // 1990s-2000s
                // ===========================================

                // -- The Shawshank Redemption (1994) --
                'Get busy coding, or get busy hitting the rate limit',

                // -- Pulp Fiction (1994) --
                'The path of the righteous coder is beset on all sides by token limits',
                'Check out the big brain on Brett. Token math at this level requires it.',

                // -- The Usual Suspects (1995) --
                'The greatest trick the rate limit ever pulled was convincing the world it didn\'t exist',

                // -- The Big Lebowski (1998) --
                'That\'s just, like, your token opinion, man',

                // -- Office Space (1999) --
                'PC Load Letter? What does that even... oh, token warning.',

                // -- Austin Powers (1997) --
                'One MILLION tokens! Mwahaha! ...we\'re mostly there already.',

                // -- Braveheart (1995) --
                'They may take our tokens, but they\'ll never take our FREEEEDOOOOM',

                // -- The Matrix (1999) --
                'There is a difference between knowing the token limit and hitting the token limit',

                // -- Galaxy Quest (1999) --
                'By Grabthar\'s hammer, by the suns of Worvan, you shall use tokens wisely',

                // -- Toy Story (1995) --
                'You are a sad, strange little token budget. And you have my pity.',

                // -- The Truman Show (1998) --
                'Good morning, and in case I don\'t see ya: tokens',

                // -- Monty Python and the Meaning of Life (1983) --
                'It\'s just a wafer-thin token... sir',

                // -- Goodfellas (1990) --
                'Funny how? Funny like a token limit? Funny like it amuses you?',

                // -- Speed (1994) --
                'Pop quiz, hotshot. Tokens are dropping. What do you do?',

                // ===========================================
                // BOOKS / TV
                // ===========================================

                // -- The Hitchhiker\'s Guide (book, 1979) --
                'The token warnings hung in the air in much the same way that bricks don\'t',

                // -- Discworld / Terry Pratchett --
                'Give a man a token and he\'ll code for a day. Set a man on fire...',

                // -- Doctor Who --
                'Wibbly wobbly, tokeny wokeny',

                // -- Firefly (2002) --
                'I aim to misbehave. Tokens aim to deplete.',

                // -- Seinfeld (1989-1998) --
                'No tokens for you! ...if you keep this up.',

                // -- The IT Crowd (2006-2013) --
                'Have you tried turning your token budget off and on again?'
            ]
        },
        // =========================================================
        // IDLE (<75%) - All good, relaxed, positive vibes
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
                'Of all the IDEs in all the towns in all the world, this session\'s tokens are fine',
                'Play it again, Claude',

                // -- Gone with the Wind (1939) --
                'Tomorrow is another day. Today\'s tokens, however, are now.',

                // -- The Wizard of Oz (1939) --
                'There\'s no place like home. Especially with these token levels.',
                'Follow the yellow brick road. Tokens pave the way.',

                // -- Citizen Kane (1941) --
                'Rosebud... was the name of a really solid token budget',

                // -- It\'s a Wonderful Life (1946) --
                'Every time a token refreshes, an angel gets its wings',
                'Attaboy, Claude!',

                // -- Singin\' in the Rain (1952) --
                'What a glorious feeling — I\'m coding again',

                // -- Sunset Boulevard (1950) --
                'All right, Mr. DeMille, I\'m ready for my close-up. Tokens: ready too.',

                // -- Some Like It Hot (1959) --
                'Nobody\'s perfect. But these token levels are close.',

                // -- All About Eve (1950) --
                'Fasten your seatbelts. It\'s going to be a bumpy session.',

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
                'No, Mr. Bond, I expect you to... keep coding',

                // -- Mary Poppins (1964) --
                'Supercalifragilisticexpialidocious token levels',

                // -- Cool Hand Luke (1967) --
                'What we\'ve got here is a perfectly good token situation',

                // -- Lawrence of Arabia (1962) --
                'Big things have small beginnings. Like token budgets.',

                // ===========================================
                // 1970s
                // ===========================================

                // -- The Godfather Part II (1974) --
                'Keep your friends close, your tokens closer',

                // -- Jaws (1975) riff --
                'You\'re gonna need a... no, you\'re fine actually',

                // -- Monty Python and the Holy Grail (1975) --
                'What is the airspeed velocity of an unladen token context? Plenty fast.',

                // -- Young Frankenstein (1974) --
                'It\'s alive! The token budget IT\'S ALIVE!',

                // ===========================================
                // RP1 ERA (late 1970s-1990s)
                // ===========================================

                // -- Star Wars (1977-1983) --
                'May the tokens be with you',
                'The Force is strong with your quota',
                'Luminous beings are we. With luminous token reserves.',

                // -- 2001: A Space Odyssey (1968) --
                'Hello Dave, would you like a game of chess?',

                // -- Star Trek: TOS (1966-1969) --
                'All systems nominal, Captain',
                'Fascinating. Token efficiency at optimal levels.',
                'Live long and prosper',
                'Set phasers to productive',
                'Worrying about tokens at this level is highly illogical',

                // -- Star Trek: TNG (1987-1994) --
                'Make it so. Token levels: engaged.',
                'Tea, Earl Grey, hot. Tokens, nominal, stable.',

                // -- Army of Darkness (1992) --
                'Groovy! Tokens looking good',
                'Hail to the Token king, baby.',

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
                'Like, oh my God, tokens are SO fine right now.',
                'Token levels are rad.',
                'Tokens are, like, totally awesome to the max. TOTALLY.',
                'Fer sure, fer sure. Token budget looking choice.',
                'That is SO not even a problem. Tokens: bitchin',
                'Bag your face, rate limit. Tokens are grody to the max... ly good.',
                'As if! Tokens running low? No way!',
                'Take a chill pill. Token levels are mint.',
                'Dude. Duuuude. DUUUUUDE. Tokens: major.',
                'Don\'t have a cow, man. Tokens are fresh.',
                'Barf me out! ...wait, tokens are actually excellent.',
                'Tokens are like, totally to the max right now. No duh.',
                'Tubular! Token vibes are, like, way cosmic.',
                'That token budget is grody... grody GOOD.',
                'Oh em gee, tokens? Like, so not even an issue.',
                'Psych! You thought tokens were low? As IF.',
                'Token levels: most triumphant. Excellent. *air guitar*',
                'Like, whatever. Tokens are fine. Totally.',
                'Tokens are all that and a bag of chips.',
                'TOTALLY fine. Like, LITERALLY totally fine.',
                'Like like like like like — sorry, tokens are fine.',
                'Awesome token levels!',
                'Token vibes are, like, super good?',

                // -- The A-Team (1983-1987) --
                'I love it when a plan comes together',

                // -- Super Mario Bros (1985) --
                'It\'s-a me, Claude-io!',

                // -- Toy Story (1995) --
                'To infinity and beyond! Or at least to the token limit',

                // -- Ghostbusters (1984) --
                'I ain\'t afraid of no rate limit',
                'Back off, man. I\'m a token scientist.',

                // -- Ferris Bueller\'s Day Off (1986) --
                'Life moves pretty fast. Your tokens don\'t have to.',

                // -- The Princess Bride (1987) --
                'Have fun storming the codebase!',
                'Truly, you have a dizzying token allocation',

                // -- Bill & Ted\'s Excellent Adventure (1989) --
                'Excellent! Token levels most outstanding!',

                // -- Back to the Future (1985) --
                'Roads? Where we\'re going... we still need tokens',
                'Great Scott! Those are some healthy token levels!',

                // -- Wayne\'s World (1992) --
                'Party time! Excellent! Token levels most triumphant!',

                // -- The Hitchhiker\'s Guide (1979) --
                'Don\'t Panic -- token levels nominal',
                'The answer is 42. Your token percentage is much better.',
                'So long, and thanks for all the tokens. Wait, we still have them.',

                // -- Willy Wonka (1971) --
                'Come with me, and you\'ll be, in a world of pure token allocation',

                // -- The Karate Kid (1984) --
                'Wax on, wax off, tokens on, tokens... still on',

                // -- WarGames (1983) --
                'Shall we play a game? Token budget says yes.',
                'The only winning move is to keep coding',

                // -- Tron (1982) --
                'Greetings, program! Token grid: online.',

                // -- Short Circuit (1986) --
                'Need input! Plenty of token capacity for it.',

                // -- RoboCop (1987) --
                'Dead or alive, you\'re coding with me',

                // -- Big Trouble in Little China (1986) --
                'It\'s all in the reflexes',

                // -- They Live (1988) --
                'I have come here to chew bubblegum and write code. And I\'ve got plenty of both.',

                // -- Aliens (1986) --
                'Affirmative. Token levels within parameters.',

                // -- Predator (1987) --
                'I ain\'t got time to bleed. Tokens ain\'t bleeding either.',

                // -- Die Hard (1988) --
                'Now I have tokens. Ho. Ho. Ho.',

                // -- Highlander (1986) --
                'There can be only one... rate limit, and we\'re nowhere near it',

                // -- Real Genius (1985) --
                'Was it a dream where you had plenty of tokens? No, it\'s real.',

                // -- Spaceballs (1987) --
                'May the Schwartz be with your token budget',

                // -- Flash Gordon (1980) --
                'Flash! Ah-ahhh! Saviour of the token universe',

                // -- Dune (1984 / 2021) --
                'The tokens must flow',

                // -- Caddyshack (1980) --
                'Be the token. Danny. Be the token.',
                'Cinderella story... out of nowhere... perfect token levels',

                // -- Airplane! (1980) --
                'I just want to tell you both: good luck. We\'re all counting on your tokens.',
                'Looks like I picked the right week to have plenty of tokens',

                // -- The Breakfast Club (1985) --
                'We\'re all pretty bizarre. Some of us are just better at token management.',

                // -- Stand By Me (1986) --
                'I never had friends later like I had when I had tokens. Who does?',

                // -- Crocodile Dundee (1986) --
                'That\'s not a token budget. THIS is a token budget.',

                // -- Heathers (1988) --
                'How very... token-sufficient of you',

                // -- Weird Science (1985) --
                'So, what would you little maniacs like to do with all these tokens?',

                // -- Uncle Buck (1989) --
                'Here\'s a token: a big one.',

                // -- Groundhog Day (1993) --
                'It\'s a beautiful day. Token-wise, at least.',
                'I\'m a god. Not THE God. But a token god.',

                // ===========================================
                // 1990s-2000s
                // ===========================================

                // -- Office Space (1999) --
                'Yeah, if you could just keep those token levels, that\'d be great',
                'I believe you have my tokens',

                // -- The Matrix (1999) --
                'I know kung fu. And I know your tokens are fine.',
                'Free your mind. Token budget: ample.',
                'There is no spoon. But there are plenty of tokens.',
                'Whoa.',

                // -- Jurassic Park (1993) --
                'Life, uh, finds a way. So do tokens.',
                'Welcome to Token Park.',

                // -- Forrest Gump (1994) --
                'Life is like a box of tokens. You\'ve got plenty.',
                'Run, Forrest, run! Tokens are keeping pace.',
                'And just like that, my tokens were fine',

                // -- The Shawshank Redemption (1994) --
                'Get busy coding, or get busy digging',
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

                // -- Apollo 13 (1995) --
                'Failure is not an option. Token-wise, that\'s correct.',

                // -- The Lion King (1994) --
                'Hakuna Matata! No token worries for the rest of your session.',

                // -- Space Jam (1996) --
                'I believe I can fly, on these tokens',

                // -- Napoleon Dynamite (2004) --
                'Tokens! GOSH!',
                'I caught you a delicious bass. And some tokens.',

                // -- Anchorman (2004) --
                'I\'m kind of a big deal. Token levels confirm it.',
                'Well that escalated... at perfectly reasonable token levels',

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
                'I aim to misbehave. Tokens aim to persist.',
                'You can\'t take the sky from me. Or these tokens.',

                // -- The X-Files (1993-2002) --
                'The truth is out there. But the tokens are right here.',

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

                // -- Hitchhiker\'s Guide radio series (1978) --
                'Share and enjoy! Tokens: shared and enjoyed.',

                // -- Pac-Man (1980) --
                'Waka waka waka. Tokens: plenty.',

                // -- Zelda (1986) --
                'It\'s dangerous to go alone! Take these tokens.',

                // -- Ghostbusters cartoon (1986-1991) --
                'Who ya gonna call? Nobody. Tokens are fine.',

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

                // -- SimCity 2000 (1993) - 10 variations on the iconic loading
                //    message, so the reference lands often without going stale.
                'Reticulating splines',
                'Re-reticulating splines',
                'Reticulating sub-splines',
                'Spline reticulation: complete',
                'Adjusting spline reticulation parameters',
                'Awaiting confirmation of spline reticulation',
                'Recalibrating the spline reticulator',
                'Polishing the bevels on freshly-reticulated splines',
                'Splining the reticulations',
                'Splines reticulated. Tokens reticulated. I don\'t know what either of those mean.'
            ]
        }
};

module.exports = { ACTIVITY_DESCRIPTIONS };
