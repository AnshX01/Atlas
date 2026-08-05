from datetime import UTC, datetime

from app.domain.schemas import BriefingItem
from app.services.briefing_service import _compute_focus_score


def create_mock_item(score: int) -> BriefingItem:
    return BriefingItem(
        id=f"test-{score}",
        type="email",
        title="Test Item",
        summary="Test Summary",
        source="Gmail",
        priority_score=score,
        timestamp=datetime.now(UTC),
    )


def test_focus_score_empty_returns_zero():
    score, label = _compute_focus_score([])
    assert score == 0
    assert label == "✨ Clear Day"


def test_focus_score_single_item():
    items = [create_mock_item(85)]
    score, label = _compute_focus_score(items)
    # 85 * 0.7 + 0 * 0.3 = 59
    assert score == 59
    assert label == "🟡 Moderate Focus Day"


def test_focus_score_weighted_formula():
    items = [
        create_mock_item(90),
        create_mock_item(80),
        create_mock_item(70),
        create_mock_item(40),
        create_mock_item(20),
    ]
    # top 3 = [90, 80, 70] -> avg = 80
    # rest = [40, 20] -> avg = 30
    # expected = 80 * 0.7 + 30 * 0.3 = 56 + 9 = 65
    score, label = _compute_focus_score(items)
    assert score == 65
    assert label == "🟡 Moderate Focus Day"


def test_focus_label_high():
    items = [create_mock_item(100), create_mock_item(95), create_mock_item(90)]
    # top 3 avg = 95, rest avg = 0 -> 95 * 0.7 = 66
    # Wait, if there are no rest items, the rest_avg is 0. So it's 95 * 0.7 = 66.
    # To get >= 80, we need high scores in rest too, or just a lot of high scores.
    # Let's add some rest items.
    items += [create_mock_item(100), create_mock_item(100)]
    # top 3 = [100, 100, 100], rest = [95, 90]
    # top_avg = 100, rest_avg = 92.5
    # score = 70 + 27.75 = 97
    score, label = _compute_focus_score(items)
    assert score >= 80
    assert label == "🔴 High Focus Day"


def test_focus_label_moderate():
    items = [
        create_mock_item(80),
        create_mock_item(70),
        create_mock_item(60),
        create_mock_item(50),
        create_mock_item(40),
    ]
    score, label = _compute_focus_score(items)
    assert 55 <= score < 80
    assert label == "🟡 Moderate Focus Day"


def test_focus_label_light():
    items = [
        create_mock_item(40),
        create_mock_item(40),
        create_mock_item(40),
        create_mock_item(20),
        create_mock_item(20),
    ]
    score, label = _compute_focus_score(items)
    assert 30 <= score < 55
    assert label == "🟢 Light Day"


def test_focus_label_clear():
    items = [
        create_mock_item(20),
        create_mock_item(20),
        create_mock_item(20),
        create_mock_item(10),
        create_mock_item(10),
    ]
    score, label = _compute_focus_score(items)
    assert score < 30
    assert label == "✨ Clear Day"
