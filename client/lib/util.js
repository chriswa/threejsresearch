function loadQueryString() {
	var params = {}
	var queryElements = document.location.search.substring(1).split(/\&/)
	for (var i in queryElements) {
		var nameVal = queryElements[i].split(/\=/)
		params[unescape(nameVal[0])] = unescape(nameVal[1])
	}
	return params
}
