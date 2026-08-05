from app.services.chunker import chunk_text


def test_empty_string_returns_empty_list():
    assert chunk_text("") == []


def test_whitespace_only_returns_empty_list():
    assert chunk_text("   \n\t  ") == []


def test_short_text_returns_single_chunk():
    text = "This is a short text."
    chunks = chunk_text(text, max_tokens=10, overlap=2)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_long_text_produces_multiple_chunks():
    # 15 words
    text = "word " * 15
    text = text.strip()

    # max 10 words per chunk, 2 overlap
    # chunk 1: words 0-10
    # chunk 2: words 8-15
    chunks = chunk_text(text, max_tokens=10, overlap=2)
    assert len(chunks) == 2
    assert len(chunks[0].split()) == 10
    assert len(chunks[1].split()) == 7  # (15 - 10 + 2 = 7)


def test_chunk_overlap_correct():
    words = [f"w{i}" for i in range(10)]
    text = " ".join(words)

    chunks = chunk_text(text, max_tokens=6, overlap=2)
    assert len(chunks) == 2

    chunk1_words = chunks[0].split()
    chunk2_words = chunks[1].split()

    assert chunk1_words == ["w0", "w1", "w2", "w3", "w4", "w5"]
    assert chunk2_words == ["w4", "w5", "w6", "w7", "w8", "w9"]


def test_no_words_lost():
    text = "one two three four five six seven eight nine ten"
    chunks = chunk_text(text, max_tokens=4, overlap=1)

    all_words = set(text.split())
    chunked_words = set()
    for chunk in chunks:
        chunked_words.update(chunk.split())

    assert all_words == chunked_words
